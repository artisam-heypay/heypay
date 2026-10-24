import { createHash } from "node:crypto";
import {
  Account,
  Address,
  Keypair,
  SorobanDataBuilder,
  TransactionBuilder,
  scValToNative,
  xdr,
  type Transaction,
  type rpc,
} from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  buildEscrowTimeoutRefund,
  type EscrowTimeoutRefundInstructions,
} from "./escrow-timeout-refund";

const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "CDGIYVERJJ7JWIZBHNV3BYGKFOFHNTRAS4XW4KKV4ROTWQAGENI3LE5E";

// The account the deposit came from: nothing here ever holds its secret.
const own = Keypair.random().publicKey();
const jobId = createHash("sha256").update("payment-1").digest();

function instructions(
  over: Partial<EscrowTimeoutRefundInstructions> = {},
): EscrowTimeoutRefundInstructions {
  return {
    paymentId: "payment-1",
    contractId: CONTRACT_ID,
    jobId: jobId.toString("hex"),
    from: own,
    networkPassphrase: PASSPHRASE,
    rpcUrl: "https://rpc.test",
    validUntil: new Date(Date.now() + 90_000).toISOString(),
    ...over,
  };
}

// Minimal fake of the rpc.Server surface the builder uses.
function fakeServer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getAccount: vi.fn(async (publicKey: string) => new Account(publicKey, "41")),
    simulateTransaction: vi.fn().mockResolvedValue({
      _parsed: true,
      id: "1",
      latestLedger: 100,
      events: [],
      minResourceFee: "100",
      transactionData: new SorobanDataBuilder(),
      result: { auth: [], retval: xdr.ScVal.scvVoid() },
    }),
    sendTransaction: vi.fn(),
    ...overrides,
  };
}

function build(
  server: ReturnType<typeof fakeServer>,
  over: Partial<EscrowTimeoutRefundInstructions> = {},
) {
  return buildEscrowTimeoutRefund(instructions(over), { server: server as unknown as rpc.Server });
}

describe("buildEscrowTimeoutRefund", () => {
  it("builds an unsigned refund_after_timeout sourced by the account the deposit came from", async () => {
    const server = fakeServer();
    const validUntil = new Date(Date.now() + 90_000).toISOString();
    const built = await build(server, { validUntil });

    const tx = TransactionBuilder.fromXDR(built.xdr, PASSPHRASE) as Transaction;
    expect(tx.source).toBe(own);
    expect(tx.signatures).toHaveLength(0);
    expect(tx.hash().toString("hex")).toBe(built.txHash);

    expect(tx.operations).toHaveLength(1);
    const call = (tx.operations[0] as { func: xdr.HostFunction }).func.invokeContract();
    const args = call.args().map((a) => scValToNative(a));
    expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(CONTRACT_ID);
    expect(call.functionName().toString()).toBe("refund_after_timeout");
    // The job id and nothing else: the contract knows who the job is from.
    expect(args).toHaveLength(1);
    expect(Buffer.from(args[0] as Uint8Array).equals(jobId)).toBe(true);

    expect(Number(tx.timeBounds!.maxTime)).toBe(Math.floor(Date.parse(validUntil) / 1000));
    // Nothing is sent: only the payer's wallet can sign it.
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("reports the contract's refusal when the deadline has not passed", async () => {
    const server = fakeServer({
      simulateTransaction: vi.fn().mockResolvedValue({
        _parsed: true,
        id: "1",
        latestLedger: 100,
        events: [],
        error: "HostError: Error(Contract, #7)",
      }),
    });
    await expect(build(server)).rejects.toMatchObject({
      name: "EscrowCallBuildError",
      reason: "simulation_failed",
      detail: "HostError: Error(Contract, #7)",
    });
  });

  it("says so when the account is not on the network", async () => {
    const server = fakeServer({
      getAccount: vi.fn().mockRejectedValue(new Error(`Account not found: ${own}`)),
    });
    await expect(build(server)).rejects.toMatchObject({ reason: "account_not_found" });
    expect(server.simulateTransaction).not.toHaveBeenCalled();
  });

  it("refuses a valid-until that could leave it valid for ever", async () => {
    const server = fakeServer();
    await expect(build(server, { validUntil: "1970-01-01T00:00:00.000Z" })).rejects.toThrow(
      "no longer valid",
    );
    expect(server.getAccount).not.toHaveBeenCalled();
  });
});
