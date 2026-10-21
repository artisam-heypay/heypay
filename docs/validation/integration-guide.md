# Integration guide: HeyPay's settlement escrow on Stellar Testnet

This guide shows another Stellar project how to reuse the three pieces HeyPay
built in its Instawards sprint:

1. **A Soroban escrow** that holds a payer's funds under a job id until the
   operator releases them (the merchant was paid) or refunds them (the payout
   failed), with a refund the payer can take alone once a deadline passes.
2. **USDC that stays USDC**: a trustline, a DEX swap, and a route check that
   refuses a payment before the payer signs if it could not be held and
   refunded in the same asset.
3. **Signing with the payer's own wallet** (Freighter): the server says what
   the transaction must be, the browser builds it, the wallet signs it, and the
   server checks it before sending.

Every code block below comes from a file in [`snippets/`](snippets/). Each
snippet makes its own accounts with Friendbot and its own escrow instance, so it
runs on Testnet with no keys or setup, and prints Stellar Expert links for every
transaction it makes.

For the full function, error and event reference, see the
[SDK and API reference](escrow-sdk.md). To check HeyPay's own transactions on
Stellar Expert, claim by claim and without reading code, see the
[verification page](verify.md).

Technical demo video: link to come.

## What is published

| Item                           | Where                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract source (MIT)          | [`contracts/escrow`](../../contracts/escrow)                                                                                                                                  |
| Release for independent checks | [`escrow-v1.0-testnet`](https://github.com/artisam-heypay/heypay/releases/tag/escrow-v1.0-testnet): `escrow.wasm`, `escrow.wasm.sha256`, `INTERFACE.md`, `events.sample.json` |
| Compiled WASM                  | `escrow.wasm` in that release, sha256 `f3ccfe37fa39403a82bc835f18f0b68c83d1503a5d058ec02ae5878143872f60`                                                                      |
| Interface (ABI)                | [`contracts/escrow/INTERFACE.md`](../../contracts/escrow/INTERFACE.md), exported from the deployed contract                                                                   |
| Sample event payloads          | [`contracts/escrow/events.sample.json`](../../contracts/escrow/events.sample.json)                                                                                            |
| SDK / API reference            | [`escrow-sdk.md`](escrow-sdk.md)                                                                                                                                              |
| Route-check module (MIT)       | [`packages/settlement-route`](../../packages/settlement-route)                                                                                                                |
| HeyPay's XLM escrow (Testnet)  | [`CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J`](https://stellar.expert/explorer/testnet/contract/CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J)       |
| HeyPay's USDC escrow (Testnet) | [`CAR76EFULGIFGWV4UQIFP5J5GUSRUMBQ3CH4TY5GW4FJCXKDXNYI66EG`](https://stellar.expert/explorer/testnet/contract/CAR76EFULGIFGWV4UQIFP5J5GUSRUMBQ3CH4TY5GW4FJCXKDXNYI66EG)       |

### Check that the deployed contract is the published code

```sh
curl -sSLO https://github.com/artisam-heypay/heypay/releases/download/escrow-v1.0-testnet/escrow.wasm
shasum -a 256 escrow.wasm

stellar contract fetch --network testnet -o deployed.wasm \
  --id CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J
shasum -a 256 deployed.wasm
```

Both print `f3ccfe37…2f60`. The USDC instance runs the same WASM. The release
also carries `escrow.wasm.sha256`, so `shasum -a 256 -c escrow.wasm.sha256`
checks the download. Building `contracts/escrow` from the tag with
`stellar contract build --package escrow` (Stellar CLI 28.1.0, rustc 1.98.0)
gives the same hash.

## Before you start

You need Node 20 or later and, for the CLI examples, the
[Stellar CLI](https://developers.stellar.org/docs/tools/cli) (tested with
28.1.0).

In this repo, `pnpm install`, then run any snippet:

```sh
pnpm exec tsx docs/validation/snippets/02-deposit-and-release.ts
```

In your own project:

```sh
npm install @stellar/stellar-sdk
stellar contract bindings typescript --network testnet \
  --contract-id CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J \
  --output-dir ./escrow-client
```

Then copy [`snippets/shared.ts`](snippets/shared.ts) and point its `Client`
import at `./escrow-client`. The snippets use Testnet by default; set
`SOROBAN_RPC_URL` and `HORIZON_URL` to use other servers.

### The shared helpers

[`snippets/shared.ts`](snippets/shared.ts) holds what every snippet uses. The
two you need to understand:

```ts
/** The escrow at `contractId`. Calls are sourced and signed by `signer`; reads need none. */
export function escrowClient(contractId: string, signer?: Keypair): Client {
  return new Client({
    contractId,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    ...(signer && {
      publicKey: signer.publicKey(),
      ...basicNodeSigner(signer, NETWORK_PASSPHRASE),
    }),
  });
}

/**
 * Simulates, signs, sends and waits for a contract call. A call the contract
 * would refuse fails at simulation with `EscrowRejected`, before anything is
 * signed. Returns the transaction hash once it has succeeded on-chain.
 */
export async function send(
  method: string,
  tx: AssembledTransaction<{ isErr(): boolean } | unknown>,
): Promise<string> {
  const result = tx.result as { isErr?: () => boolean } | undefined;
  if (result?.isErr?.()) throw rejection(method, tx);
  // force: a write the client misjudges as read-only must still be sent.
  const sent = await tx.signAndSend({ force: true });
  const hash = sent.sendTransactionResponse?.hash ?? "";
  const status = sent.getTransactionResponse?.status;
  if (status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${method} transaction ${hash} ended ${status ?? "without a result"}`);
  }
  return hash;
}
```

Amounts are `bigint` stroops (1 XLM or 1 USDC is `10_000_000n`); `toStroops(10)`
converts. A job id is any 32 bytes; `jobIdFor(orderId)` is `sha256(orderId)`,
as HeyPay does with its payment ids.

## 1. Deploy and initialize an escrow

One instance holds one token. You deploy your own from the published WASM hash
(nothing to build or upload) and initialize it in the next transaction. The
admin must sign `initialize`, so no one can hand the contract to an account
that did not agree. `release` pays the admin, so make it the account that funds
your payouts.

```ts
export async function deployEscrow(admin: Keypair, token: string) {
  const deploy = await Client.deploy({
    wasmHash: ESCROW_WASM_HASH,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: admin.publicKey(),
    ...basicNodeSigner(admin, NETWORK_PASSPHRASE),
  });
  const deployed = await deploy.signAndSend();
  const contractId = deployed.result.options.contractId;

  const initTx = await send(
    "initialize",
    await escrowClient(contractId, admin).initialize({ admin: admin.publicKey(), token }),
  );
  return { contractId, deployTx: deployed.sendTransactionResponse?.hash ?? "", initTx };
}

// An XLM escrow: the token is native XLM's Stellar Asset Contract.
const { contractId } = await deployEscrow(admin, Asset.native().contractId(Networks.TESTNET));
```

Full file: [`01-deploy-and-initialize.ts`](snippets/01-deploy-and-initialize.ts).
It also reads back `admin()`, `token()` and `timeout()`.

The same with the Stellar CLI:

```sh
stellar keys generate my-admin --network testnet --fund
stellar contract deploy --network testnet --source my-admin \
  --wasm-hash f3ccfe37fa39403a82bc835f18f0b68c83d1503a5d058ec02ae5878143872f60
# prints the new contract ID, C...
stellar contract invoke --network testnet --source my-admin --id <C...> -- \
  initialize --admin "$(stellar keys address my-admin)" \
  --token "$(stellar contract id asset --asset native --network testnet)"
```

## 2. Deposit, then release or refund

The payer signs `deposit`; the funds move from the payer into the contract.
Then the operator settles the job once, one way or the other:

- `release`: the payout succeeded. The funds go to the admin.
- `refund`: the payout failed. The funds go back to the payer.

Neither takes a destination address, so even a stolen admin key can only send
held funds to the admin or back to the payer.

```ts
const jobId = jobIdFor(`order-${Date.now()}`);

// deposit: the payer signs; the 10 XLM move from the payer into the contract.
const depositTx = await send(
  "deposit",
  await escrowClient(contractId, payer).deposit({
    job_id: jobId,
    from: payer.publicKey(),
    amount: toStroops(10),
  }),
);
const held = await readJob(contractId, jobId); // { status: "Held", amount, deadline_ledger, from }

// release: only the admin can, and the funds can only go to the admin.
const releaseTx = await send(
  "release",
  await escrowClient(contractId, admin).release({ job_id: jobId }),
);

// A job settles once: a second release is refused at simulation with NotHeld.
```

For a failed payout, call `refund` instead of `release`:

```ts
const refundTx = await send(
  "refund",
  await escrowClient(contractId, admin).refund({ job_id: jobId }),
);
```

Full files: [`02-deposit-and-release.ts`](snippets/02-deposit-and-release.ts)
(including the refused second release) and
[`03-deposit-and-refund.ts`](snippets/03-deposit-and-refund.ts) (with the
payer's balance before and after).

## 3. The payer's own refund after the deadline

If the operator never acts, the payer does not have to trust it. Every deposit
records `deadline_ledger = deposit ledger + timeout`. From that ledger on, the
payer can call `refund_after_timeout` with their own signature, and the funds
come back to them. Before it, the contract refuses with `DeadlineNotReached`.
The admin cannot make this call.

```ts
const payerClient = escrowClient(contractId, payer);
const { deadline_ledger: deadline } = await readJob(contractId, jobId);

// Too early: refused at simulation, nothing is sent.
try {
  await send("refund_after_timeout", await payerClient.refund_after_timeout({ job_id: jobId }));
} catch (err) {
  if (!(err instanceof EscrowRejected)) throw err;
  console.log(err.code); // DeadlineNotReached
}

// Wait for the deadline ledger (about 5 seconds per ledger on Testnet).
while ((await sorobanRpc.getLatestLedger()).sequence < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

const refundTx = await send(
  "refund_after_timeout",
  await payerClient.refund_after_timeout({ job_id: jobId }),
);
```

The default window is 17,280 ledgers (about 24 hours). The snippet shortens it
to 4 ledgers with the admin-only `set_timeout(4)` so it finishes in seconds.
`set_timeout` only changes deposits made after it; a held job keeps its
deadline.

Full file: [`04-refund-after-timeout.ts`](snippets/04-refund-after-timeout.ts).

## 4. USDC: trustline, swap and the route check

An escrow initialized with USDC's token holds, releases and refunds USDC and
nothing else. What can still go wrong is found only when a transaction is
sent: the payer has no USDC trustline, the destination cannot hold USDC, or the
instance set for USDC holds another token. `@heypay/settlement-route` asks
those questions before the payer signs.

Wire the route check to Horizon and your escrow instance:

```ts
import { createSettlementRouteResolver } from "@heypay/settlement-route";

type Code = "XLM" | "USDC";
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const stellarAsset = (code: Code) => (code === "XLM" ? Asset.native() : USDC);

/** The balance lines of `account` for `code`, from any issuer. Empty when the account is missing. */
async function linesFor(account: string, code: Code) {
  const { balances } = await horizon.loadAccount(account).catch(() => ({ balances: [] }));
  return balances.flatMap((b) => ("asset_code" in b && b.asset_code === code ? [b] : []));
}

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

const route = await resolveSettlementRoute({
  asset: "USDC",
  amount: "1",
  payerPublicKey: payer.publicKey(),
});
// Before the payer trusts USDC: { ok: false, reason: "payer_no_trustline" }
```

The payer's own step is the trustline, a `change_trust`. Then they can buy USDC
on the DEX with a strict-send path payment, accepting at most 1% less than the
best route quoted now:

```ts
await sendClassic(payer, Operation.changeTrust({ asset: USDC }));

const { records } = await horizon.strictSendPaths(Asset.native(), "20", [USDC]).call();
const best = records[0]; // undefined when the DEX has no route
await sendClassic(
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

// Now: { ok: true, escrowId: contractId, route: { mode: "direct", ... } }
```

The deposit, release and refund calls are the same as in section 2, on an
instance initialized with `tokenOf(USDC)`. A refund returns USDC to the payer,
never XLM. The network fee is always paid in XLM, so a USDC payer still needs a
little XLM.

| `reason` when `ok` is false | What to tell the payer                                 |
| --------------------------- | ------------------------------------------------------ |
| `no_escrow`                 | This asset cannot be paid right now                    |
| `escrow_holds_other_asset`  | Pay with another asset                                 |
| `payer_no_trustline`        | Add the USDC trustline first                           |
| `payer_other_issuer`        | That "USDC" is from another issuer and is not accepted |
| `destination_no_trustline`  | Pay with another asset                                 |
| `no_dex_path`               | Try a smaller amount                                   |

Full file: [`05-usdc-trustline-and-preflight.ts`](snippets/05-usdc-trustline-and-preflight.ts).
It deploys a USDC instance, shows the refusal, adds the trustline, swaps,
shows the direct route, then deposits 1 USDC and refunds it. More on the module
in its [README](../../packages/settlement-route/README.md).

## 5. The payer signs with Freighter

To keep the operator out of key custody, the payer's own wallet signs the
deposit. The operator never sees the key, so it has to check what comes back.
HeyPay splits this into four steps.

**1. The server says what the deposit must be.** Every value comes from the
order, and the transaction may not stay valid for long:

```ts
function prepareDeposit(contractId: string, payer: string, orderId: string): DepositInstructions {
  return {
    contractId,
    from: payer,
    jobId: jobIdFor(orderId).toString("hex"),
    amount: toStroops(2).toString(), // stroops as a string: an i128 does not fit a JSON number
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    validUntil: new Date(Date.now() + 120_000).toISOString(),
  };
}
```

**2. The browser builds and simulates it** with the payer's account as the
transaction's source. The payer's signature on the envelope is then the only
authorisation `deposit` needs:

```ts
const depositArgs = (i: DepositInstructions): xdr.ScVal[] => [
  nativeToScVal(Buffer.from(i.jobId, "hex"), { type: "bytes" }),
  new Address(i.from).toScVal(),
  nativeToScVal(BigInt(i.amount), { type: "i128" }),
];

async function buildDeposit(i: DepositInstructions): Promise<string> {
  const server = new rpc.Server(i.rpcUrl);
  const raw = new TransactionBuilder(await server.getAccount(i.from), {
    fee: BASE_FEE,
    networkPassphrase: i.networkPassphrase,
    // A max time of 0 would mean "never expires".
    timebounds: { minTime: 0, maxTime: Math.floor(Date.parse(i.validUntil) / 1000) },
  })
    .addOperation(new Contract(i.contractId).call("deposit", ...depositArgs(i)))
    .build();

  const sim = await server.simulateTransaction(raw);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${sim.error}`);
  const sourceOnly = (sim.result?.auth ?? []).every(
    (entry) => entry.credentials().switch().name === "sorobanCredentialsSourceAccount",
  );
  if (!sourceOnly) throw new Error("The deposit asks for a signature besides the payer's");
  return rpc.assembleTransaction(raw, sim).build().toXDR();
}
```

**3. Freighter signs it.** In the browser, through StellarWalletsKit
([`snippets/freighter.ts`](snippets/freighter.ts)):

```ts
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { FREIGHTER_ID, FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";

StellarWalletsKit.init({ modules: [new FreighterModule()], selectedWalletId: FREIGHTER_ID });

const { address } = await StellarWalletsKit.fetchAddress(); // the payer's G... account
const { signedTxXdr } = await StellarWalletsKit.signTransaction(unsignedXdr, {
  networkPassphrase: Networks.TESTNET,
  address,
});
```

Check `StellarWalletsKit.getNetwork()` first: an account on another network
would sign something this one refuses. Under Node, the snippet signs with a
`Keypair` instead, so it can run without a browser.

**4. The server checks it is exactly that deposit, then sends it.** Anything
else is refused before the network sees it: another contract, function,
argument or source, an extra operation, a fee bump, a validity that never ends
or runs past the limit, or a signature from any other key.

```ts
function checkSignedDeposit(signedXdr: string, i: DepositInstructions): Transaction {
  const tx = TransactionBuilder.fromXDR(signedXdr, i.networkPassphrase);
  if (tx instanceof FeeBumpTransaction) throw new Error("A fee bump is not the payer's own");
  if (tx.source !== i.from) throw new Error("Not from the payer's account");

  const [op, ...others] = tx.operations;
  if (!op || others.length > 0 || op.type !== "invokeHostFunction") {
    throw new Error("Not a single contract call");
  }
  if (op.source !== undefined && op.source !== i.from) throw new Error("Operation source differs");
  if (op.func.switch().name !== "hostFunctionTypeInvokeContract") throw new Error("Not a call");
  const call = op.func.invokeContract();
  const expectedArgs = depositArgs(i).map((a) => a.toXDR("base64"));
  const sameCall =
    Address.fromScAddress(call.contractAddress()).toString() === i.contractId &&
    call.functionName().toString() === "deposit" &&
    call.args().length === expectedArgs.length &&
    call.args().every((arg, n) => arg.toXDR("base64") === expectedArgs[n]);
  if (!sameCall) throw new Error("Not the deposit that was prepared");

  const maxTime = Number(tx.timeBounds?.maxTime ?? 0) * 1000;
  if (maxTime <= 0 || maxTime > Date.parse(i.validUntil)) throw new Error("Validity too long");
  if (maxTime <= Date.now()) throw new Error("Expired");

  const key = Keypair.fromPublicKey(i.from);
  const signed = tx.signatures.some((s) => key.verify(tx.hash(), s.signature()));
  if (!signed) throw new Error("Not signed by the payer's key");
  return tx;
}

async function submit(tx: Transaction): Promise<string> {
  const server = new rpc.Server(RPC_URL);
  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
    throw new Error(`Network did not take the deposit: ${sent.status}`);
  }
  const done = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Deposit ${sent.hash} ended ${done.status}`);
  }
  return sent.hash;
}
```

The operator then settles as in section 2, with `release` or `refund` signed by
the admin. It never needed the payer's key. A payer-signed
`refund_after_timeout` follows the same four steps.

Full file: [`06-sign-with-own-wallet.ts`](snippets/06-sign-with-own-wallet.ts).
It also shows a deposit signed by another key being refused. In HeyPay these
steps are `POST /api/payments/:id/prepare`, `src/lib/client/escrow-deposit.ts`,
`src/components/wallet/freighter.ts` and `POST /api/payments/:id/signed`; see
the [own-wallet API](escrow-sdk.md#own-wallet-api).

## Check every transaction yourself

Every snippet prints a `https://stellar.expert/explorer/testnet/tx/<hash>` link
for each transaction. On that page:

- **Operations** shows the contract and function called (`deposit`,
  `release`, ...) and its arguments.
- **Events** shows the escrow's own event (`["escrow", "deposit", <job id>]`)
  and the token's `transfer`, with the amount and both addresses.
- **Source account** is the account that signed the transaction and paid its
  fee. For section 5 it is the payer, not the operator.

From the command line:

```sh
stellar tx fetch events --hash <tx hash> --network testnet --output json
stellar contract invoke --network testnet --id <C...> --source <any identity> --send=no -- \
  get_job --job_id <64 hex chars>
```

## Snippet runs

Every snippet was run on Testnet on 2026-10-19. Each run made its own accounts
and escrow instance.

| Snippet                           | Transactions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-deploy-and-initialize`        | deploy [`eb679c99…`](https://stellar.expert/explorer/testnet/tx/eb679c995ce3dab15b309ee6660f2028ca321c90f42da7297071d92cadee1e61), initialize [`7ace19d6…`](https://stellar.expert/explorer/testnet/tx/7ace19d61b2a6d2b0cbbdc23ca1a62a5c9ec7f00d5ca9eeb79b02214e89b1423)                                                                                                                                                                                                                                                                                          |
| `02-deposit-and-release`          | deposit [`7d3b7580…`](https://stellar.expert/explorer/testnet/tx/7d3b7580ae8d170d2f57419b2b1811a03ed971b60e84131cdfb391f98f12e305), release [`b8563fba…`](https://stellar.expert/explorer/testnet/tx/b8563fba263a2800c4fedcb8b06b1a737e8884ea352c1043bdb1f8a87e942f74); second release refused with `NotHeld`                                                                                                                                                                                                                                                     |
| `03-deposit-and-refund`           | deposit [`a114b58d…`](https://stellar.expert/explorer/testnet/tx/a114b58d21eef4d0e075daa041e4355b41a59e05a2f821d8563830f64fe84142), refund [`cf30082f…`](https://stellar.expert/explorer/testnet/tx/cf30082f9fc20fea884077d69338672662225dfdbf07b96ea67ed53c3245bbf3)                                                                                                                                                                                                                                                                                             |
| `04-refund-after-timeout`         | set_timeout [`93896235…`](https://stellar.expert/explorer/testnet/tx/938962352924ed010c971883780f853fea97a42a1093ba5b60be19d6f40c128a), deposit [`28a3a12b…`](https://stellar.expert/explorer/testnet/tx/28a3a12bf4fd66d673c4dcef9e358cf901173764a49e5997453566071b4323a0), refund_after_timeout [`3d42939c…`](https://stellar.expert/explorer/testnet/tx/3d42939c91275fcab2644d8ee2c5364f26862ba61668a9741836482ca503abe6); early call refused with `DeadlineNotReached`                                                                                         |
| `05-usdc-trustline-and-preflight` | change_trust [`5de22a50…`](https://stellar.expert/explorer/testnet/tx/5de22a50ebb45b748b32072dc706ad252b1679084efdf9094ac684e725d3a07d), path payment [`4e3c74c0…`](https://stellar.expert/explorer/testnet/tx/4e3c74c0bdd6309276e5817554304d16776a61e8141ac92e8d88acd25ce20ddb), USDC deposit [`b87e95f0…`](https://stellar.expert/explorer/testnet/tx/b87e95f0a96f8f89c20d964e7317acbe646e7a833bd267483fa2e846379e3002), USDC refund [`a49078d6…`](https://stellar.expert/explorer/testnet/tx/a49078d6a0cc0315e96bc58be2e0214383a8cd4c3f80e50c411743423de54cfc) |
| `06-sign-with-own-wallet`         | payer-signed deposit [`d680c39b…`](https://stellar.expert/explorer/testnet/tx/d680c39b3337d269b95addaae1c83a22ac2a57e78fc67027b42aeae1952853c9), release [`dc13b1eb…`](https://stellar.expert/explorer/testnet/tx/dc13b1ebaa42bc0e5f35dfc89c14b782e2857698db9b2430bad33b84287cc4ff); deposit signed by another key refused                                                                                                                                                                                                                                        |

These runs show the snippets work. HeyPay's own payments through its deployed
escrows are in the [on-chain receipt list](receipts.md).

## License

The escrow contract, the route-check module and these snippets are MIT
licensed.
