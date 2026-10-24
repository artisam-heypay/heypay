// The escrow deposit a payer signs with their own wallet, built in their
// browser. The server says what the deposit must be
// (POST /api/payments/[id]/prepare) and checks the signed transaction against
// the payment when it comes back.
import type { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { buildEscrowCall, jobIdBytes, type EscrowCallInstructions } from "./escrow-call";

/** What the deposit for one payment must be, as the server hands it over. */
export type EscrowDepositInstructions = EscrowCallInstructions & {
  paymentId: string;
  /** The payment's job id, hex: the contract's `BytesN<32>`. */
  jobId: string;
  /** In stroops, as a string: an i128 does not fit a JSON number. */
  amount: string;
};

/**
 * The unsigned `deposit(jobId, from, amount)` for a payment, simulated and
 * ready for the payer's wallet to sign. The payer's account is both the
 * transaction's source and the deposit's `from`. Nothing is signed or sent here.
 */
export function buildEscrowDeposit(
  instructions: EscrowDepositInstructions,
  options: { server?: SorobanRpc.Server } = {},
): Promise<{ xdr: string; txHash: string }> {
  const { jobId, from, amount } = instructions;
  return buildEscrowCall(
    instructions,
    "deposit",
    ({ Address, nativeToScVal }) => [
      nativeToScVal(jobIdBytes(jobId), { type: "bytes" }),
      new Address(from).toScVal(),
      nativeToScVal(BigInt(amount), { type: "i128" }),
    ],
    options,
  );
}
