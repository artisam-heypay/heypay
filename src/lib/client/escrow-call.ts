// Builds, in the payer's browser, a call on the escrow that they sign with their
// own wallet. The payer's account is the transaction's source, so its signature
// on the envelope is all the contract's `require_auth()` asks for, and no key of
// HeyPay's has any part in it. The server says what the call must be and checks
// the signed transaction against the payment when it comes back.
import type { rpc as SorobanRpc, xdr } from "@stellar/stellar-sdk";

type StellarSdk = typeof import("@stellar/stellar-sdk");

/** What every escrow call the payer signs needs, as the server hands it over. */
export type EscrowCallInstructions = {
  /** The escrow contract that holds the payment's asset. */
  contractId: string;
  /** The payer's own account: the transaction's source. */
  from: string;
  networkPassphrase: string;
  /** The Soroban RPC server the browser asks to simulate the call. */
  rpcUrl: string;
  /** ISO time after which the network no longer takes the transaction. */
  validUntil: string;
};

/**
 * Why no transaction was built: the payer's account is not on the network, the
 * network would not run the call (the reason is in `detail`), or running it
 * needs a signature besides the payer's own.
 */
export class EscrowCallBuildError extends Error {
  constructor(
    readonly reason: "account_not_found" | "simulation_failed" | "needs_other_signature",
    readonly detail?: string,
  ) {
    super(`Escrow call could not be built: ${reason}`);
    this.name = "EscrowCallBuildError";
  }
}

/** A payment's job id as the contract's `BytesN<32>`. */
export function jobIdBytes(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) throw new Error("Escrow job id is not hex");
  return Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
}

/**
 * The unsigned call of `method` on the escrow, simulated and ready for the
 * payer's wallet to sign. Nothing is signed or sent here.
 */
export async function buildEscrowCall(
  instructions: EscrowCallInstructions,
  method: string,
  args: (sdk: StellarSdk) => xdr.ScVal[],
  options: { server?: SorobanRpc.Server } = {},
): Promise<{ xdr: string; txHash: string }> {
  // Loaded when a call is being made, so other pages do not carry the SDK.
  const sdk = await import("@stellar/stellar-sdk");
  const { BASE_FEE, Contract, TransactionBuilder, rpc } = sdk;
  const { contractId, from, networkPassphrase, rpcUrl } = instructions;

  // A max time of 0 means "never expires" to the network. A transaction the
  // payer could sign and send at any later time must not exist.
  const maxTime = Math.floor(new Date(instructions.validUntil).getTime() / 1000);
  if (!Number.isInteger(maxTime) || maxTime <= 0) {
    throw new Error("Escrow call needs a time after which it is no longer valid");
  }

  const server =
    options.server ?? new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  let account;
  try {
    account = await server.getAccount(from);
  } catch (err) {
    throw new EscrowCallBuildError("account_not_found", String(err));
  }

  const raw = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
    timebounds: { minTime: 0, maxTime },
  })
    .addOperation(new Contract(contractId).call(method, ...args(sdk)))
    .build();

  const sim = await server.simulateTransaction(raw);
  if (rpc.Api.isSimulationError(sim)) {
    throw new EscrowCallBuildError("simulation_failed", sim.error);
  }
  if (rpc.Api.isSimulationRestore(sim)) {
    throw new EscrowCallBuildError("simulation_failed", "contract state has expired");
  }
  // The payer signs the envelope and nothing else. An authorisation that asked
  // for any other signature would make that transaction fail.
  const sourceOnly = (sim.result?.auth ?? []).every(
    (entry) => entry.credentials().switch().name === "sorobanCredentialsSourceAccount",
  );
  if (!sourceOnly) throw new EscrowCallBuildError("needs_other_signature");

  const tx = rpc.assembleTransaction(raw, sim).build();
  return { xdr: tx.toXDR(), txHash: tx.hash().toString("hex") };
}
