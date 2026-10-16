// src/server/payments/signed-call.ts
//
// A transaction a payer signed with their own wallet. HeyPay built none of it
// and holds no key that could sign it, so before the network sees it, it is
// checked to be exactly one call on the escrow, from the payer's own account,
// signed by that account's key, and valid no longer than allowed. The escrow
// deposit (payments/signed.ts) and the payer's own refund after the deadline
// (payments/escrow-self-refund.ts) both come in this way.
import "server-only";
import {
  Address,
  FeeBumpTransaction,
  Keypair,
  TransactionBuilder,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";
import { badRequest } from "@/lib/errors";
import { sendSignedTransaction, type SendOutcome } from "@/server/stellar/escrow";
import { getNetworkPassphrase } from "@/server/stellar/horizon";

// Two servers' clocks are never quite the same; the one that checks may be a
// little behind the one that named the transaction's last valid second.
export const CLOCK_SLACK_SECONDS = 5;

/** What a transaction the payer signed has to be: one call on the escrow. */
export type ExpectedEscrowCall = {
  /** The payer's own account: the transaction's source and its signer. */
  from: string;
  /** The escrow instance that holds the payment's asset. */
  contractId: string;
  method: string;
  /** Each argument exactly as the payment has it. */
  args: xdr.ScVal[];
  /** In ms: the transaction may not be valid past it. */
  notAfter: number;
};

/** Why a signed transaction is not the expected call. */
export type SignedCallFault =
  /** Something in it differs from the call the payment asks for. */
  | "not_the_call"
  /** Its validity has run out. */
  | "expired"
  /** Not signed by the key of the payer's own account. */
  | "not_signed";

/** GABC…WXYZ: enough to recognise an account in a message. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Why `tx` is not the expected call, or null when it is. Nothing here trusts
 * the browser: every part of the transaction that decides where money goes,
 * how much, from whom and until when is compared with what is expected.
 */
export function signedCallFault(
  tx: Transaction,
  expected: ExpectedEscrowCall,
  now: number = Date.now(),
): SignedCallFault | null {
  const { from } = expected;
  // The payer's account pays, and its signature on the envelope is the whole
  // authorisation the contract asks for.
  if (tx.source !== from) return "not_the_call";

  // One operation, the contract call, and nothing riding along with it.
  const [op, ...others] = tx.operations;
  if (!op || others.length > 0 || op.type !== "invokeHostFunction") return "not_the_call";
  if (op.source !== undefined && op.source !== from) return "not_the_call";
  if (op.func.switch().name !== "hostFunctionTypeInvokeContract") return "not_the_call";

  const call = op.func.invokeContract();
  if (Address.fromScAddress(call.contractAddress()).toString() !== expected.contractId) {
    return "not_the_call";
  }
  if (call.functionName().toString() !== expected.method) return "not_the_call";
  const args = call.args();
  const sameArgs =
    args.length === expected.args.length &&
    args.every((arg, i) => arg.toXDR("base64") === expected.args[i]!.toXDR("base64"));
  if (!sameArgs) return "not_the_call";

  // A last valid second of 0 means "never expires". The transaction must stop
  // being valid, and no later than allowed.
  const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
  if (!Number.isInteger(maxTime) || maxTime <= 0) return "not_the_call";
  const validUntil = maxTime * 1000;
  if (validUntil <= now) return "expired";
  if (validUntil > expected.notAfter) return "not_the_call";

  // Signed by the account's own key, for this network: the hash that is signed
  // takes the network in, so a signature made for another one fails.
  const key = Keypair.fromPublicKey(from);
  const hash = tx.hash();
  const signed = tx.signatures.some((signature) => {
    try {
      return key.verify(hash, signature.signature());
    } catch {
      return false;
    }
  });
  return signed ? null : "not_signed";
}

/** Reads the envelope the payer's wallet handed back, or refuses it. */
export function readSignedTransaction(envelope: string): Transaction {
  const problem = badRequest("That is not a Stellar transaction HeyPay can read.", {
    reason: "not_a_transaction",
  });
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(envelope, getNetworkPassphrase());
  } catch {
    throw problem;
  }
  // A fee bump wraps a transaction in another account's envelope; what the
  // payer signs is their own and nobody else's.
  if (tx instanceof FeeBumpTransaction) throw problem;
  return tx;
}

// A network too busy to take the transaction is asked again a couple of times.
const SEND_ATTEMPTS = 3;
const SEND_RETRY_MS = 1000;

/** Hands the network the transaction as it came, asking again while it is busy. */
export async function sendSigned(tx: Transaction): Promise<SendOutcome> {
  for (let attempt = 1; ; attempt++) {
    const outcome = await sendSignedTransaction(tx);
    if (outcome.status !== "busy" || attempt === SEND_ATTEMPTS) return outcome;
    await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_MS));
  }
}
