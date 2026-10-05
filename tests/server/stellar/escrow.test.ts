import { createHash, randomBytes } from "node:crypto";
import {
  Account,
  Address,
  Keypair,
  SorobanDataBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  type Transaction,
  type rpc,
} from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@/lib/money";
import { __resetKeyringForTests, encryptSecret } from "@/server/crypto/envelope";
import {
  EscrowContractError,
  EscrowTxFailedError,
  __resetSorobanRpcForTests,
  createEscrowService,
  escrowFor,
  escrowJobId,
  toStroops,
} from "@/server/stellar/escrow";

const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "CDGIYVERJJ7JWIZBHNV3BYGKFOFHNTRAS4XW4KKV4ROTWQAGENI3LE5E";
const USDC_CONTRACT_ID = "CAR76EFULGIFGWV4UQIFP5J5GUSRUMBQ3CH4TY5GW4FJCXKDXNYI66EG";
const TX_HASH = "a".repeat(64);

const payer = Keypair.random();
const admin = Keypair.random();
const jobId = escrowJobId("payment-1");

let payerSecretEnc: string;
let adminSecretEnc: string;

beforeEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = `base64:${randomBytes(32).toString("base64")}`;
  process.env.ENCRYPTION_KEY_VERSION = "1";
  __resetKeyringForTests();
  payerSecretEnc = encryptSecret(payer.secret());
  adminSecretEnc = encryptSecret(admin.secret());
});

function simSuccess(retval: xdr.ScVal = xdr.ScVal.scvVoid()) {
  return {
    _parsed: true,
    id: "1",
    latestLedger: 100,
    events: [],
    minResourceFee: "100",
    transactionData: new SorobanDataBuilder(),
    result: { auth: [], retval },
  };
}

function simContractError(code: number) {
  return {
    _parsed: true,
    id: "1",
    latestLedger: 100,
    events: [],
    error: `HostError: Error(Contract, #${code})`,
  };
}

// Minimal fake of the rpc.Server surface the contract client uses.
function fakeServer(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    serverURL: new URL("https://rpc.test"),
    getAccount: vi.fn(async (publicKey: string) => new Account(publicKey, "1")),
    simulateTransaction: vi.fn().mockResolvedValue(simSuccess()),
    sendTransaction: vi.fn().mockResolvedValue({ status: "PENDING", hash: TX_HASH }),
    getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
    ...overrides,
  };
  return base;
}

function service(server: ReturnType<typeof fakeServer>) {
  return createEscrowService({
    server: server as unknown as rpc.Server,
    contractId: CONTRACT_ID,
    networkPassphrase: PASSPHRASE,
    adminEncryptedSecret: adminSecretEnc,
  });
}

/** The transaction handed to sendTransaction, its invoked function and args. */
function sentCall(server: ReturnType<typeof fakeServer>) {
  const tx = server.sendTransaction.mock.calls[0]![0] as Transaction;
  const op = tx.operations[0] as { func: xdr.HostFunction };
  const call = op.func.invokeContract();
  return {
    tx,
    contractId: Address.fromScAddress(call.contractAddress()).toString(),
    fn: call.functionName().toString(),
    args: call.args().map((a) => scValToNative(a)),
  };
}

function signedBy(tx: Transaction, keypair: Keypair): boolean {
  return tx.signatures.some((s) => keypair.verify(tx.hash(), s.signature()));
}

describe("escrowJobId", () => {
  it("is sha256 of the payment id, as 32 bytes", () => {
    const id = escrowJobId("payment-1");
    expect(id).toHaveLength(32);
    expect(id.equals(createHash("sha256").update("payment-1").digest())).toBe(true);
  });
});

describe("toStroops", () => {
  it("converts whole and fractional amounts", () => {
    expect(toStroops(new Decimal("10"))).toBe(100_000_000n);
    expect(toStroops(new Decimal("0.0000001"))).toBe(1n);
  });

  it("rejects zero, negative and sub-stroop amounts", () => {
    expect(() => toStroops(new Decimal(0))).toThrow();
    expect(() => toStroops(new Decimal(-1))).toThrow();
    expect(() => toStroops(new Decimal("0.00000001"))).toThrow();
  });
});

describe("EscrowService.deposit", () => {
  it("invokes deposit from the payer and returns the tx hash", async () => {
    const server = fakeServer();
    const { txHash } = await service(server).deposit({
      jobId,
      encryptedSecret: payerSecretEnc,
      amount: new Decimal("12.5"),
    });

    expect(txHash).toBe(TX_HASH);
    const { tx, fn, args } = sentCall(server);
    expect(fn).toBe("deposit");
    expect(Buffer.from(args[0] as Uint8Array).equals(jobId)).toBe(true);
    expect(args[1]).toBe(payer.publicKey());
    expect(args[2]).toBe(125_000_000n);
    expect(tx.source).toBe(payer.publicKey());
    expect(signedBy(tx, payer)).toBe(true);
  });

  it("polls getTransaction until the transaction lands", async () => {
    const server = fakeServer({
      getTransaction: vi
        .fn()
        .mockResolvedValueOnce({ status: "NOT_FOUND" })
        .mockResolvedValue({ status: "SUCCESS" }),
    });
    await service(server).deposit({
      jobId,
      encryptedSecret: payerSecretEnc,
      amount: new Decimal(1),
    });
    expect(server.getTransaction).toHaveBeenCalledTimes(2);
    expect(server.getTransaction).toHaveBeenCalledWith(TX_HASH);
  });

  it("maps JobExists to a typed error and sends nothing", async () => {
    const server = fakeServer({
      simulateTransaction: vi.fn().mockResolvedValue(simContractError(3)),
    });
    const err = await service(server)
      .deposit({ jobId, encryptedSecret: payerSecretEnc, amount: new Decimal(1) })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EscrowContractError);
    expect(err).toMatchObject({ method: "deposit", code: "JobExists" });
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("EscrowService.release / refund", () => {
  it.each(["release", "refund"] as const)("%s is sourced and signed by the admin", async (fn) => {
    const server = fakeServer();
    const { txHash } = await service(server)[fn](jobId);

    expect(txHash).toBe(TX_HASH);
    const sent = sentCall(server);
    expect(sent.fn).toBe(fn);
    expect(Buffer.from(sent.args[0] as Uint8Array).equals(jobId)).toBe(true);
    expect(sent.tx.source).toBe(admin.publicKey());
    expect(signedBy(sent.tx, admin)).toBe(true);
    expect(signedBy(sent.tx, payer)).toBe(false);
  });

  it("maps NotHeld (already settled) to a typed error", async () => {
    const server = fakeServer({
      simulateTransaction: vi.fn().mockResolvedValue(simContractError(5)),
    });
    await expect(service(server).release(jobId)).rejects.toMatchObject({
      name: "EscrowContractError",
      method: "release",
      code: "NotHeld",
    });
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("throws EscrowTxFailedError when the transaction fails on-chain", async () => {
    const server = fakeServer({
      getTransaction: vi.fn().mockResolvedValue({ status: "FAILED" }),
    });
    const err = await service(server)
      .refund(jobId)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EscrowTxFailedError);
    expect(err).toMatchObject({ method: "refund", txHash: TX_HASH, status: "FAILED" });
  });

  it("surfaces simulation failures that are not contract errors", async () => {
    const server = fakeServer({
      simulateTransaction: vi.fn().mockResolvedValue({
        _parsed: true,
        id: "1",
        latestLedger: 100,
        events: [],
        error: "HostError: Error(Budget, ExceededLimit)",
      }),
    });
    await expect(service(server).release(jobId)).rejects.toThrow(/ExceededLimit/);
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects a send the RPC does not accept", async () => {
    const server = fakeServer({
      sendTransaction: vi.fn().mockResolvedValue({ status: "ERROR", hash: TX_HASH }),
    });
    await expect(service(server).release(jobId)).rejects.toThrow(/Sending the transaction/);
    expect(server.getTransaction).not.toHaveBeenCalled();
  });
});

describe("EscrowService.refundAfterTimeout", () => {
  it("is sourced and signed by the payer, never the admin", async () => {
    const server = fakeServer();
    const { txHash } = await service(server).refundAfterTimeout({
      jobId,
      encryptedSecret: payerSecretEnc,
    });

    expect(txHash).toBe(TX_HASH);
    const sent = sentCall(server);
    expect(sent.fn).toBe("refund_after_timeout");
    expect(Buffer.from(sent.args[0] as Uint8Array).equals(jobId)).toBe(true);
    expect(sent.tx.source).toBe(payer.publicKey());
    expect(signedBy(sent.tx, payer)).toBe(true);
    expect(signedBy(sent.tx, admin)).toBe(false);
  });

  it("maps DeadlineNotReached to a typed error and sends nothing", async () => {
    const server = fakeServer({
      simulateTransaction: vi.fn().mockResolvedValue(simContractError(7)),
    });
    await expect(
      service(server).refundAfterTimeout({ jobId, encryptedSecret: payerSecretEnc }),
    ).rejects.toMatchObject({
      name: "EscrowContractError",
      method: "refund_after_timeout",
      code: "DeadlineNotReached",
    });
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });
});

describe("EscrowService timeout", () => {
  it("reads the self-refund window without sending anything", async () => {
    const server = fakeServer({
      simulateTransaction: vi
        .fn()
        .mockResolvedValue(simSuccess(nativeToScVal(17_280, { type: "u32" }))),
    });

    expect(await service(server).getTimeout()).toBe(17_280);
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("sets the window as the admin", async () => {
    const server = fakeServer();
    const { txHash } = await service(server).setTimeout(12);

    expect(txHash).toBe(TX_HASH);
    const sent = sentCall(server);
    expect(sent.fn).toBe("set_timeout");
    expect(sent.args[0]).toBe(12);
    expect(sent.tx.source).toBe(admin.publicKey());
    expect(signedBy(sent.tx, admin)).toBe(true);
  });

  it("reads the network's latest ledger", async () => {
    const server = fakeServer({
      getLatestLedger: vi
        .fn()
        .mockResolvedValue({ id: "x", protocolVersion: 23, sequence: 4_985_221 }),
    });

    expect(await service(server).getLatestLedger()).toBe(4_985_221);
  });
});

describe("EscrowService.getJob", () => {
  it("decodes a stored job", async () => {
    const job = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("amount"),
        val: nativeToScVal(125_000_000n, { type: "i128" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("deadline_ledger"),
        val: nativeToScVal(4_941_229, { type: "u32" }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("from"),
        val: new Address(payer.publicKey()).toScVal(),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("status"),
        val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Held")]),
      }),
    ]);
    const server = fakeServer({ simulateTransaction: vi.fn().mockResolvedValue(simSuccess(job)) });

    const result = await service(server).getJob(jobId);

    expect(result).not.toBeNull();
    expect(result!.from).toBe(payer.publicKey());
    expect(result!.amount.equals(new Decimal("12.5"))).toBe(true);
    expect(result!.deadlineLedger).toBe(4_941_229);
    expect(result!.status).toBe("Held");
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns null for a job that was never deposited", async () => {
    const server = fakeServer({
      simulateTransaction: vi.fn().mockResolvedValue(simContractError(4)),
    });
    await expect(service(server).getJob(jobId)).resolves.toBeNull();
  });
});

describe("EscrowService.getFeeCharged", () => {
  it("returns the fee the transaction charged, in XLM", async () => {
    const resultXdr = { feeCharged: () => xdr.Int64.fromString("1060597") };
    const server = fakeServer({
      getTransaction: vi.fn().mockResolvedValue({ status: "SUCCESS", resultXdr }),
    });

    const fee = await service(server).getFeeCharged(TX_HASH);

    expect(fee!.toFixed(7)).toBe("0.1060597");
    expect(server.getTransaction).toHaveBeenCalledWith(TX_HASH);
  });

  it("returns null when the RPC no longer has the transaction", async () => {
    const server = fakeServer({
      getTransaction: vi.fn().mockResolvedValue({ status: "NOT_FOUND" }),
    });

    expect(await service(server).getFeeCharged(TX_HASH)).toBeNull();
  });
});

describe("escrowFor", () => {
  afterEach(() => {
    delete process.env.ESCROW_CONTRACT_ID_USDC;
    delete process.env.SOROBAN_RPC_URL;
    __resetSorobanRpcForTests();
  });

  it("sends to the contract ID read when the call is made", async () => {
    const server = fakeServer();
    let contractId = CONTRACT_ID;
    const escrow = createEscrowService({
      server: server as unknown as rpc.Server,
      contractId: () => contractId,
      networkPassphrase: PASSPHRASE,
      adminEncryptedSecret: adminSecretEnc,
    });
    contractId = USDC_CONTRACT_ID;
    await escrow.release(jobId);
    expect(sentCall(server).contractId).toBe(USDC_CONTRACT_ID);
  });

  it("fails the call, not the lookup, when the asset's contract ID is not set", async () => {
    process.env.SOROBAN_RPC_URL = "https://rpc.test";
    const escrow = escrowFor("USDC");
    await expect(escrow.getTimeout()).rejects.toThrow("ESCROW_CONTRACT_ID_USDC is not set");
  });

  it("refuses an asset that has no escrow", () => {
    expect(() => escrowFor("USDT")).toThrow("No escrow holds USDT");
  });
});
