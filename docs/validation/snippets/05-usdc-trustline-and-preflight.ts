// docs/validation/snippets/05-usdc-trustline-and-preflight.ts
//
// USDC end to end. A payer with no USDC trustline is refused by the route
// check before anything is signed. They add the trustline (change_trust), buy
// USDC on the DEX (path payment, strict send), and the same check now returns
// a direct route through a USDC escrow. The deposit is held in USDC and the
// refund returns USDC, because an instance only ever holds the one token it
// was initialized with.
//
//   pnpm exec tsx docs/validation/snippets/05-usdc-trustline-and-preflight.ts
import { Asset, Operation } from "@stellar/stellar-sdk";
import { createSettlementRouteResolver } from "@heypay/settlement-route";
import {
  USDC,
  balanceOf,
  deployEscrow,
  escrowClient,
  fundedAccount,
  horizon,
  jobIdFor,
  readJob,
  run,
  send,
  sendClassic,
  toStroops,
  tokenOf,
  txUrl,
} from "./shared";

type Code = "XLM" | "USDC";
const stellarAsset = (code: Code) => (code === "XLM" ? Asset.native() : USDC);

/** The balance lines of `account` for `code`, from any issuer. Empty when the account is missing. */
async function linesFor(account: string, code: Code) {
  const { balances } = await horizon.loadAccount(account).catch(() => ({ balances: [] }));
  return balances.flatMap((b) => ("asset_code" in b && b.asset_code === code ? [b] : []));
}

run(async () => {
  const [admin, payer] = await Promise.all([fundedAccount(), fundedAccount()]);

  // The admin is where `release` pays, so it must hold USDC too.
  await sendClassic(admin, Operation.changeTrust({ asset: USDC }));
  const { contractId } = await deployEscrow(admin, tokenOf(USDC));

  // The route check, wired to Horizon and to this escrow instance.
  const resolveSettlementRoute = createSettlementRouteResolver<Code, string, Asset>({
    fallbackAsset: "XLM",
    isIssuedAsset: (code) => code !== "XLM",
    getDepositAddress: async () => ({ address: admin.publicKey(), memo: null }),
    async canReceive(account, code) {
      if (code === "XLM") return (await horizon.loadAccount(account).catch(() => null)) !== null;
      return (await linesFor(account, code)).some(
        (b) => "asset_issuer" in b && b.asset_issuer === USDC.issuer,
      );
    },
    async holdsOtherIssuer(account, code) {
      return (await linesFor(account, code)).some(
        (b) => "asset_issuer" in b && b.asset_issuer !== USDC.issuer && Number(b.balance) > 0,
      );
    },
    async findStrictSendPaths(from, to, amount) {
      const { records } = await horizon
        .strictSendPaths(stellarAsset(from), amount, [stellarAsset(to)])
        .call();
      return records.map((r) => ({ destAmount: r.destination_amount, path: [] }));
    },
    escrow: {
      appliesTo: (code) => code === "USDC",
      contractId: (code) => (code === "USDC" ? contractId : null),
      // The instance must hold USDC's own token, or a refund would return another asset.
      holdsAsset: async (code) =>
        (await escrowClient(contractId).token()).result.unwrap() === tokenOf(stellarAsset(code)),
    },
  });
  const check = () =>
    resolveSettlementRoute({ asset: "USDC", amount: "1", payerPublicKey: payer.publicKey() });

  const before = await check();
  console.log("route before the trustline:", before.ok ? "ok" : before.reason);

  // 1. The payer's own step: trust USDC.
  const trustTx = await sendClassic(payer, Operation.changeTrust({ asset: USDC }));
  console.log("change_trust", txUrl(trustTx));

  // 2. Buy USDC with 20 XLM, accepting at most 1% less than the best route quoted now.
  const { records } = await horizon.strictSendPaths(Asset.native(), "20", [USDC]).call();
  const best = records[0];
  if (!best) throw new Error("The Testnet DEX has no XLM to USDC route right now");
  const swapTx = await sendClassic(
    payer,
    Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(),
      sendAmount: "20",
      destination: payer.publicKey(),
      destAsset: USDC,
      destMin: (Number(best.destination_amount) * 0.99).toFixed(7),
      path: best.path.map((p) =>
        p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer),
      ),
    }),
  );
  console.log("path payment", txUrl(swapTx), `(about ${best.destination_amount} USDC)`);

  const after = await check();
  console.log(
    "route after:",
    after.ok ? `${after.route.mode}, held by ${after.escrowId}` : after.reason,
  );
  if (!after.ok) return;

  // 3. Hold 1 USDC in the escrow, then refund it: the payer gets USDC back, not XLM.
  const jobId = jobIdFor(`usdc-order-${Date.now()}`);
  const depositTx = await send(
    "deposit",
    await escrowClient(contractId, payer).deposit({
      job_id: jobId,
      from: payer.publicKey(),
      amount: toStroops(1),
    }),
  );
  console.log("deposit (USDC)", txUrl(depositTx));
  console.log("  payer USDC", await balanceOf(payer.publicKey(), USDC));

  const refundTx = await send(
    "refund",
    await escrowClient(contractId, admin).refund({ job_id: jobId }),
  );
  console.log("refund (USDC) ", txUrl(refundTx));
  console.log("  payer USDC", await balanceOf(payer.publicKey(), USDC));
  console.log("  job", (await readJob(contractId, jobId)).status);
});
