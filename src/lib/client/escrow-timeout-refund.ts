// The payer's own way out of the escrow, signed with their own wallet: once a
// held job's deadline ledger has passed, the account the deposit came from
// calls `refund_after_timeout` and takes the crypto back. Only that account can,
// and HeyPay holds no key to it, so the payer's browser builds the call. The
// server says what it must be (POST /api/payments/[id]/escrow-refund/prepare)
// and checks the signed transaction when it comes back.
import type { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { buildEscrowCall, jobIdBytes, type EscrowCallInstructions } from "./escrow-call";

/** What the refund for one payment must be, as the server hands it over. */
export type EscrowTimeoutRefundInstructions = EscrowCallInstructions & {
  paymentId: string;
  /** The payment's job id, hex: the contract's `BytesN<32>`. */
  jobId: string;
};

/**
 * The unsigned `refund_after_timeout(jobId)` for a payment, simulated and ready
 * for the payer's wallet to sign. Nothing is signed or sent here.
 */
export function buildEscrowTimeoutRefund(
  instructions: EscrowTimeoutRefundInstructions,
  options: { server?: SorobanRpc.Server } = {},
): Promise<{ xdr: string; txHash: string }> {
  return buildEscrowCall(
    instructions,
    "refund_after_timeout",
    ({ nativeToScVal }) => [nativeToScVal(jobIdBytes(instructions.jobId), { type: "bytes" })],
    options,
  );
}
