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
import { EscrowCallBuildError } from "./escrow-call";
import { buildEscrowDeposit, type EscrowDepositInstructions } from "./escrow-deposit";

const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "CDGIYVERJJ7JWIZBHNV3BYGKFOFHNTRAS4XW4KKV4ROTWQAGENI3LE5E";

// The payer's own account: nothing here ever holds its secret.
const own = Keypair.random().publicKey();
const jobId = createHash("sha256").update("payment-1").digest();

function instructions(over: Partial<EscrowDepositInstructions> = {}): EscrowDepositInstructions {
  return {
    paymentId: "payment-1",
    contractId: CONTRACT_ID,
    jobId: jobId.toString("hex"),
    from: own,
    amount: "125000000",
    networkPassphrase: PASSPHRASE,
    rpcUrl: "https://rpc.test",
    validUntil: new Date(Date.now() + 90_000).toISOString(),
    ...over,
  };
}

function simSuccess(auth: xdr.SorobanAuthorizationEntry[] = []) {
  return {
    _parsed: true,
    id: "1",
    latestLedger: 100,
    events: [],
    minResourceFee: "100",
    transactionData: new SorobanDataBuilder(),
    result: { auth, retval: xdr.ScVal.scvVoid() },
  };
}

// Minimal fake of the rpc.Server surface the builder uses.
function fakeServer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getAccount: vi.fn(async (publicKey: string) => new Account(publicKey, "41")),
    simulateTransaction: vi.fn().mockResolvedValue(simSuccess()),
    sendTransaction: vi.fn(),
    ...overrides,
  };
}

function build(
  server: ReturnType<typeof fakeServer>,
  over: Partial<EscrowDepositInstructions> = {},
) {
  return buildEscrowDeposit(instructions(over), { server: server as unknown as rpc.Server });
}

/** An authorisation only `address` itself can sign, apart from the envelope. */
function addressAuth(address: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(address).toScAddress(),
        nonce: xdr.Int64.fromString("1"),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(CONTRACT_ID).toScAddress(),
          functionName: "deposit",
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

describe("buildEscrowDeposit", () => {
  it("builds an unsigned deposit sourced by the payer's own account", async () => {
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
    expect(call.functionName().toString()).toBe("deposit");
    expect(Buffer.from(args[0] as Uint8Array).equals(jobId)).toBe(true);
    expect(args[1]).toBe(own);
    expect(args[2]).toBe(125_000_000n);

    // Valid until the moment the server named, and not open-ended.
    expect(Number(tx.timeBounds!.maxTime)).toBe(Math.floor(Date.parse(validUntil) / 1000));
    expect(Number(tx.timeBounds!.minTime)).toBe(0);

    // Nothing is sent: only the payer's wallet can sign it.
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("says so when the payer's account is not on the network", async () => {
    const server = fakeServer({
      getAccount: vi.fn().mockRejectedValue(new Error(`Account not found: ${own}`)),
    });
    await expect(build(server)).rejects.toMatchObject({
      name: "EscrowCallBuildError",
      reason: "account_not_found",
    });
    expect(server.simulateTransaction).not.toHaveBeenCalled();
  });

  it("reports why the network would not run the deposit", async () => {
    const server = fakeServer({
      simulateTransaction: vi.fn().mockResolvedValue({
        _parsed: true,
        id: "1",
        latestLedger: 100,
        events: [],
        error: "HostError: Error(Contract, #3)",
      }),
    });
    const err = await build(server).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EscrowCallBuildError);
    expect(err).toMatchObject({
      reason: "simulation_failed",
      detail: "HostError: Error(Contract, #3)",
    });
  });

  it("refuses a deposit the payer's signature alone would not authorise", async () => {
    const other = Keypair.random().publicKey();
    const server = fakeServer({
      simulateTransaction: vi.fn().mockResolvedValue(simSuccess([addressAuth(other)])),
    });
    await expect(build(server)).rejects.toMatchObject({ reason: "needs_other_signature" });
  });

  it.each(["1970-01-01T00:00:00.000Z", "not a date", ""])(
    "refuses a valid-until of %j, which could leave it valid for ever",
    async (validUntil) => {
      const server = fakeServer();
      await expect(build(server, { validUntil })).rejects.toThrow("no longer valid");
      expect(server.getAccount).not.toHaveBeenCalled();
    },
  );

  it("refuses a job id that is not hex", async () => {
    await expect(build(fakeServer(), { jobId: "xyz" })).rejects.toThrow("not hex");
  });
});
