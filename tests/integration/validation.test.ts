// tests/integration/validation.test.ts
//
// D4's cross-deliverable run on Testnet, with a wallet HeyPay does not control.
// One external account stands in for a payer's Freighter wallet and signs
// every payer step itself. HeyPay's code finds the swap route, builds the
// escrow calls the way the payer's browser does, checks each signed call the
// way the server does before sending it, and plays the operator's part:
//
//   1. turn on USDC         change_trust, signed by the payer
//   2. swap XLM for USDC    path payment on the DEX, along HeyPay's route
//   3. pay in USDC          escrow deposit, signed by the payer
//   4. forced failure       the mock rail fails the payout; the operator refunds
//   5. timeout self-refund  the payer takes a held job back after its deadline
//
// Then every transaction is looked up on Horizon. Skipped unless asked for:
//
//   RUN_STELLAR_IT=1 pnpm vitest run tests/integration/validation.test.ts
//
// The escrow is a new instance of the published WASM (release
// escrow-v1.0-testnet) with a throwaway operator as its admin, so the run needs
// none of HeyPay's keys. VALIDATION_PAYER_SECRET signs with a wallet of your
// own (it needs about 25 XLM); without it a new account is funded by Friendbot.
import { createHash, randomBytes } from "node:crypto";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  Address,
  rpc,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Decimal, dec } from "@/lib/money";
import { stellarTxUrl } from "@/lib/stellar-explorer";
import { EscrowCallBuildError } from "@/lib/client/escrow-call";
import { buildEscrowDeposit } from "@/lib/client/escrow-deposit";
import { buildEscrowTimeoutRefund } from "@/lib/client/escrow-timeout-refund";
import { __resetKeyringForTests, encryptSecret } from "@/server/crypto/envelope";
import {
  readSignedTransaction,
  sendSigned,
  signedCallFault,
  type ExpectedEscrowCall,
} from "@/server/payments/signed-call";
import { createMockProvider } from "@/server/rails/mock";
import { resolveStellarAsset } from "@/server/stellar/assets";
import { Client } from "@/server/stellar/escrow-bindings";
import {
  __resetSorobanRpcForTests,
  awaitSentTransaction,
  createEscrowService,
  escrowJobId,
  toStroops,
  type EscrowService,
} from "@/server/stellar/escrow";
import { __resetHorizonForTests } from "@/server/stellar/horizon";
import { findStrictSendPaths } from "@/server/stellar/paths";
import { createWalletService } from "@/server/stellar/wallet";

const RUN = process.env.STELLAR_NETWORK === "testnet" && process.env.RUN_STELLAR_IT === "1";

const PASSPHRASE = Networks.TESTNET;
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

/** sha256 of `escrow.wasm` in release escrow-v1.0-testnet, already installed on Testnet. */
const ESCROW_WASM_HASH = "f3ccfe37fa39403a82bc835f18f0b68c83d1503a5d058ec02ae5878143872f60";

const SWAP_XLM = dec("20");
/** What the payer needs: the swap, the USDC trustline's reserve, and fees. */
const PAYER_MIN_XLM = dec("25");
/** Ledgers close about every 5 seconds on Testnet. */
const TIMEOUT_WINDOW_LEDGERS = 6;
/** How long a signed escrow call stays valid, as the app's deposit does. */
const CALL_VALID_MS = 120_000;
const MOCK_BANK = { bankCode: "MOCK", accountName: "D4 Validation", accountNumber: "0000000000" };

type Receipt = { step: string; operation: string; signer: "payer" | "operator"; hash: string };

describe.skipIf(!RUN)("D4 validation: an external wallet through D1–D3 (testnet)", () => {
  const horizon = new Horizon.Server(HORIZON_URL);
  const soroban = new rpc.Server(RPC_URL);
  const rail = createMockProvider();
  const receipts: Receipt[] = [];
  const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;

  const payerSecret = process.env.VALIDATION_PAYER_SECRET;
  const payer = payerSecret ? Keypair.fromSecret(payerSecret) : Keypair.random();
  const operator = Keypair.random();
  let usdc: Asset;
  let contractId = "";
  let escrow: EscrowService;

  // Steps 3 and 4 share one payment: deposited, then refunded when its payout fails.
  const failedPayment = `d4-validation-${runId}-payout-fails`;
  const failedPhp = dec("66.66");
  let failedUsdc: Decimal;
  let balanceBeforeDeposit: Decimal;

  const wallet = () => createWalletService();
  const usdcBalance = async (): Promise<Decimal> =>
    (await wallet().getBalances(payer.publicKey(), ["USDC"]))[0]!.balance;

  async function friendbot(publicKey: string): Promise<void> {
    const res = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
    if (!res.ok) throw new Error(`Friendbot did not fund ${publicKey}: ${res.status}`);
  }

  /** What the payer's wallet does with a classic transaction: build it from its own account and sign it. */
  async function payerSends(op: xdr.Operation): Promise<string> {
    const account = await horizon.loadAccount(payer.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(op)
      .setTimeout(120)
      .build();
    tx.sign(payer);
    return (await horizon.submitTransaction(tx)).hash;
  }

  /** What Freighter does with a call HeyPay's browser code built: sign it, and change nothing. */
  function signAsWallet(envelope: string, signer: Keypair): string {
    const tx = TransactionBuilder.fromXDR(envelope, PASSPHRASE) as Transaction;
    tx.sign(signer);
    return tx.toXDR();
  }

  /** HeyPay's server side of a signed call: read it, check it is the expected one, send it, wait. */
  async function acceptSigned(envelope: string, expected: ExpectedEscrowCall): Promise<string> {
    const tx = readSignedTransaction(envelope);
    expect(signedCallFault(tx, expected)).toBeNull();
    expect(await sendSigned(tx)).toEqual({ status: "accepted" });
    const hash = tx.hash().toString("hex");
    expect(await awaitSentTransaction(hash, Date.now() + 60_000)).toBe("SUCCESS");
    return hash;
  }

  function depositInstructions(paymentId: string, amount: Decimal) {
    return {
      contractId,
      from: payer.publicKey(),
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC_URL,
      validUntil: new Date(Date.now() + CALL_VALID_MS).toISOString(),
      paymentId,
      jobId: escrowJobId(paymentId).toString("hex"),
      amount: toStroops(amount).toString(),
    };
  }

  function expectedDeposit(paymentId: string, amount: Decimal): ExpectedEscrowCall {
    return {
      from: payer.publicKey(),
      contractId,
      method: "deposit",
      args: [
        nativeToScVal(escrowJobId(paymentId), { type: "bytes" }),
        new Address(payer.publicKey()).toScVal(),
        nativeToScVal(toStroops(amount), { type: "i128" }),
      ],
      notAfter: Date.now() + CALL_VALID_MS + 5_000,
    };
  }

  /** The payer pays `amount` USDC into the escrow for `paymentId`, the way a Freighter payer does. */
  async function payIntoEscrow(paymentId: string, amount: Decimal): Promise<string> {
    const { xdr: unsigned } = await buildEscrowDeposit(depositInstructions(paymentId, amount), {
      server: soroban,
    });
    return acceptSigned(signAsWallet(unsigned, payer), expectedDeposit(paymentId, amount));
  }

  beforeAll(async () => {
    process.env.SOROBAN_RPC_URL = RPC_URL;
    process.env.STELLAR_HORIZON_URL = HORIZON_URL;
    process.env.ENCRYPTION_MASTER_KEY = `base64:${randomBytes(32).toString("base64")}`;
    process.env.ENCRYPTION_KEY_VERSION = "1";
    __resetKeyringForTests();
    __resetHorizonForTests();
    __resetSorobanRpcForTests();
    usdc = resolveStellarAsset("USDC");

    await Promise.all([
      friendbot(operator.publicKey()),
      payerSecret ? Promise.resolve() : friendbot(payer.publicKey()),
    ]);
    const xlm = await wallet().getBalance(payer.publicKey());
    if (xlm.lessThan(PAYER_MIN_XLM)) {
      throw new Error(
        `The payer ${payer.publicKey()} holds ${xlm} XLM; the run needs ${PAYER_MIN_XLM}.`,
      );
    }

    // A new escrow instance from the published WASM, with the operator as admin.
    const signer = { publicKey: operator.publicKey(), ...basicNodeSigner(operator, PASSPHRASE) };
    const deployed = await (
      await Client.deploy({
        wasmHash: ESCROW_WASM_HASH,
        networkPassphrase: PASSPHRASE,
        rpcUrl: RPC_URL,
        ...signer,
      })
    ).signAndSend();
    contractId = deployed.result.options.contractId;
    receipts.push({
      step: "setup",
      operation: "deploy escrow",
      signer: "operator",
      hash: deployed.sendTransactionResponse!.hash,
    });

    const init = await (
      await new Client({
        contractId,
        networkPassphrase: PASSPHRASE,
        rpcUrl: RPC_URL,
        ...signer,
      }).initialize({
        admin: operator.publicKey(),
        token: usdc.contractId(PASSPHRASE),
      })
    ).signAndSend({ force: true });
    expect(init.result.isOk()).toBe(true);
    receipts.push({
      step: "setup",
      operation: "initialize (holds USDC)",
      signer: "operator",
      hash: init.sendTransactionResponse!.hash,
    });

    escrow = createEscrowService({
      server: soroban,
      contractId,
      networkPassphrase: PASSPHRASE,
      adminEncryptedSecret: encryptSecret(operator.secret()),
    });
  }, 180_000);

  afterAll(() => {
    const lines = [
      "D4 validation run on Testnet",
      `payer (external wallet): ${payer.publicKey()}${payerSecret ? " (VALIDATION_PAYER_SECRET)" : " (new, funded by Friendbot)"}`,
      `operator (escrow admin): ${operator.publicKey()}`,
      `escrow: ${contractId} (WASM ${ESCROW_WASM_HASH})`,
      ...receipts.map(
        (r) =>
          `${r.step.padEnd(24)} ${r.operation.padEnd(34)} ${r.signer.padEnd(8)} ${stellarTxUrl(r.hash, "testnet")}`,
      ),
    ];
    console.log(lines.join("\n"));
  });

  it("runs the published escrow WASM and holds USDC", async () => {
    const wasm = await soroban.getContractWasmByContractId(contractId);
    expect(createHash("sha256").update(wasm).digest("hex")).toBe(ESCROW_WASM_HASH);
    expect(await escrow.getToken()).toBe(usdc.contractId(PASSPHRASE));
  }, 60_000);

  it("1. turns on USDC from the payer's own wallet", async () => {
    const hash = await payerSends(Operation.changeTrust({ asset: usdc }));
    receipts.push({ step: "1 turn on USDC", operation: "change_trust", signer: "payer", hash });

    expect(await wallet().canReceive(payer.publicKey(), "USDC")).toBe(true);
  }, 90_000);

  it("2. swaps XLM for USDC along the route HeyPay finds", async () => {
    const [route] = await findStrictSendPaths("XLM", "USDC", SWAP_XLM, horizon);
    expect(route, "the Testnet DEX has a route from XLM to USDC").toBeDefined();
    const before = await usdcBalance();

    // At most 1% less than quoted, or the network refuses the swap.
    const destMin = route!.destAmount.times(0.99).toDecimalPlaces(7, Decimal.ROUND_DOWN);
    const hash = await payerSends(
      Operation.pathPaymentStrictSend({
        sendAsset: Asset.native(),
        sendAmount: SWAP_XLM.toFixed(7),
        destination: payer.publicKey(),
        destAsset: usdc,
        destMin: destMin.toFixed(7),
        path: route!.path,
      }),
    );
    receipts.push({
      step: "2 swap XLM for USDC",
      operation: "path_payment_strict_send",
      signer: "payer",
      hash,
    });

    expect((await usdcBalance()).minus(before).greaterThanOrEqualTo(destMin)).toBe(true);
  }, 90_000);

  it("3. pays in USDC through the escrow, signed only by the payer", async () => {
    failedUsdc = (await rail.getQuote({ sell: "USDC", buy: "PHP", phpAmount: failedPhp }))
      .assetAmount;
    balanceBeforeDeposit = await usdcBalance();

    // The server refuses the deposit when any key but the payer's signed it.
    const { xdr: unsigned } = await buildEscrowDeposit(
      depositInstructions(failedPayment, failedUsdc),
      { server: soroban },
    );
    const forged = readSignedTransaction(signAsWallet(unsigned, Keypair.random()));
    expect(signedCallFault(forged, expectedDeposit(failedPayment, failedUsdc))).toBe("not_signed");

    const hash = await payIntoEscrow(failedPayment, failedUsdc);
    receipts.push({ step: "3 pay in USDC", operation: "deposit", signer: "payer", hash });

    const job = await escrow.getJob(escrowJobId(failedPayment));
    expect(job).toMatchObject({ from: payer.publicKey(), status: "Held" });
    expect(job!.amount.equals(failedUsdc)).toBe(true);
    expect(balanceBeforeDeposit.minus(await usdcBalance()).equals(failedUsdc)).toBe(true);
  }, 120_000);

  it("4. refunds the USDC when the merchant payout fails", async () => {
    // "FAIL" in the reference makes the mock rail fail the payout.
    const { payoutRef } = await rail.createPayout({
      ref: `TXN-D4VAL-FAIL-${runId}`,
      phpAmount: failedPhp,
      bank: MOCK_BANK,
      receiptEmail: null,
    });
    expect(await rail.getPayoutStatus(payoutRef)).toEqual({
      state: "FAILED",
      failureCode: "MOCK_FAILURE",
    });

    // What the settle job does on a failed payout.
    const { txHash } = await escrow.refund(escrowJobId(failedPayment));
    receipts.push({
      step: "4 forced failure",
      operation: "refund",
      signer: "operator",
      hash: txHash,
    });

    expect((await escrow.getJob(escrowJobId(failedPayment)))!.status).toBe("Refunded");
    expect((await usdcBalance()).equals(balanceBeforeDeposit)).toBe(true);
  }, 120_000);

  it("5. lets the payer take a held payment back after its deadline", async () => {
    const payment = `d4-validation-${runId}-timeout`;
    const amount = (await rail.getQuote({ sell: "USDC", buy: "PHP", phpAmount: dec("50.00") }))
      .assetAmount;
    const jobId = escrowJobId(payment);

    // Shortens the window so the run takes seconds, not a day.
    const { txHash: timeoutHash } = await escrow.setTimeout(TIMEOUT_WINDOW_LEDGERS);
    receipts.push({
      step: "5 timeout self-refund",
      operation: `set_timeout(${TIMEOUT_WINDOW_LEDGERS})`,
      signer: "operator",
      hash: timeoutHash,
    });

    const before = await usdcBalance();
    const depositHash = await payIntoEscrow(payment, amount);
    receipts.push({
      step: "5 timeout self-refund",
      operation: "deposit",
      signer: "payer",
      hash: depositHash,
    });
    const { deadlineLedger } = (await escrow.getJob(jobId))!;

    const refundInstructions = () => ({
      contractId,
      from: payer.publicKey(),
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC_URL,
      validUntil: new Date(Date.now() + CALL_VALID_MS).toISOString(),
      paymentId: payment,
      jobId: jobId.toString("hex"),
    });

    // Before the deadline the contract refuses: DeadlineNotReached is error #7.
    const early = await buildEscrowTimeoutRefund(refundInstructions(), { server: soroban }).catch(
      (err: unknown) => err,
    );
    expect(early).toBeInstanceOf(EscrowCallBuildError);
    expect((early as EscrowCallBuildError).detail).toMatch(/Error\(Contract, #7\)/);

    while ((await escrow.getLatestLedger()) < deadlineLedger) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    const { xdr: unsigned } = await buildEscrowTimeoutRefund(refundInstructions(), {
      server: soroban,
    });
    const refundHash = await acceptSigned(signAsWallet(unsigned, payer), {
      from: payer.publicKey(),
      contractId,
      method: "refund_after_timeout",
      args: [nativeToScVal(jobId, { type: "bytes" })],
      notAfter: Date.now() + CALL_VALID_MS + 5_000,
    });
    receipts.push({
      step: "5 timeout self-refund",
      operation: "refund_after_timeout",
      signer: "payer",
      hash: refundHash,
    });

    expect((await escrow.getJob(jobId))!.status).toBe("Refunded");
    expect((await usdcBalance()).equals(before)).toBe(true);
  }, 180_000);

  it("finds every transaction on-chain, each signed by its own account alone", async () => {
    expect(receipts.filter((r) => r.step !== "setup")).toHaveLength(7);

    for (const { hash, signer } of receipts) {
      const record = await horizon.transactions().transaction(hash).call();
      expect(record.successful, hash).toBe(true);

      const account = signer === "payer" ? payer : operator;
      expect(record.source_account, hash).toBe(account.publicKey());
      const tx = TransactionBuilder.fromXDR(record.envelope_xdr, PASSPHRASE) as Transaction;
      expect(tx.signatures, hash).toHaveLength(1);
      expect(account.verify(tx.hash(), tx.signatures[0]!.signature()), hash).toBe(true);
    }
  }, 120_000);
});
