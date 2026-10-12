// Builds, in the payer's browser, the escrow deposit they sign with their own
// wallet. The payer's account is the transaction's source, so its signature on
// the envelope is all the contract's `from.require_auth()` asks for, and no key
// of HeyPay's has any part in it. The server says what the deposit must be
// (POST /api/payments/[id]/prepare) and checks the signed transaction against
// the payment when it comes back.
import type { rpc as SorobanRpc } from "@stellar/stellar-sdk";

/** What the deposit for one payment must be, as the server hands it over. */
export type EscrowDepositInstructions = {
  paymentId: string;
  /** The escrow contract that holds the payment's asset. */
  contractId: string;
  /** The payment's job id, hex: the contract's `BytesN<32>`. */
  jobId: string;
  /** The payer's own account: the transaction's source and the deposit's `from`. */
  from: string;
  /** In stroops, as a string: an i128 does not fit a JSON number. */
  amount: string;
  networkPassphrase: string;
  /** The Soroban RPC server the browser asks to simulate the deposit. */
  rpcUrl: string;
  /** ISO time after which the network no longer takes the transaction. */
  validUntil: string;
};

/**
 * Why no deposit was built: the payer's account is not on the network, the
 * network would not run the deposit (the reason is in `detail`), or running it
 * needs a signature besides the payer's own.
 */
export class EscrowDepositBuildError extends Error {
  constructor(
    readonly reason: "account_not_found" | "simulation_failed" | "needs_other_signature",
    readonly detail?: string,
  ) {
    super(`Escrow deposit could not be built: ${reason}`);
    this.name = "EscrowDepositBuildError";
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) throw new Error("Escrow job id is not hex");
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
}

/**
 * The unsigned `deposit(jobId, from, amount)` for a payment, simulated and
 * ready for the payer's wallet to sign. Nothing is signed or sent here.
 */
export async function buildEscrowDeposit(
  instructions: EscrowDepositInstructions,
  options: { server?: SorobanRpc.Server } = {},
): Promise<{ xdr: string; txHash: string }> {
  // Loaded when a payment is being made, so other pages do not carry the SDK.
  const { Address, BASE_FEE, Contract, TransactionBuilder, nativeToScVal, rpc } =
    await import("@stellar/stellar-sdk");
  const { contractId, jobId, from, amount, networkPassphrase, rpcUrl } = instructions;

  // A max time of 0 means "never expires" to the network. A deposit the payer
  // could sign and send at any later time must not exist.
  const maxTime = Math.floor(new Date(instructions.validUntil).getTime() / 1000);
  if (!Number.isInteger(maxTime) || maxTime <= 0) {
    throw new Error("Escrow deposit needs a time after which it is no longer valid");
  }

  const server =
    options.server ?? new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  let account;
  try {
    account = await server.getAccount(from);
  } catch (err) {
    throw new EscrowDepositBuildError("account_not_found", String(err));
  }

  const raw = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
    timebounds: { minTime: 0, maxTime },
  })
    .addOperation(
      new Contract(contractId).call(
        "deposit",
        nativeToScVal(hexToBytes(jobId), { type: "bytes" }),
        new Address(from).toScVal(),
        nativeToScVal(BigInt(amount), { type: "i128" }),
      ),
    )
    .build();

  const sim = await server.simulateTransaction(raw);
  if (rpc.Api.isSimulationError(sim)) {
    throw new EscrowDepositBuildError("simulation_failed", sim.error);
  }
  if (rpc.Api.isSimulationRestore(sim)) {
    throw new EscrowDepositBuildError("simulation_failed", "contract state has expired");
  }
  // The payer signs the envelope and nothing else. An authorisation that asked
  // for any other signature would make that transaction fail.
  const sourceOnly = (sim.result?.auth ?? []).every(
    (entry) => entry.credentials().switch().name === "sorobanCredentialsSourceAccount",
  );
  if (!sourceOnly) throw new EscrowDepositBuildError("needs_other_signature");

  const tx = rpc.assembleTransaction(raw, sim).build();
  return { xdr: tx.toXDR(), txHash: tx.hash().toString("hex") };
}
