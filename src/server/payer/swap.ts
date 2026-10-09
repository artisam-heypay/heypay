// src/server/payer/swap.ts
//
// Swaps between XLM and USDC inside a payer's own wallet: one path payment from
// the wallet to itself, converted on the Stellar DEX.
//
// XLM to USDC is a strict send: the payer spends exactly what they typed and
// receives at least the minimum they were shown. USDC to XLM is a strict
// receive: the payer receives exactly the amount they were shown and spends at
// most what they typed.
//
// The wallet's balances are a ledger, not a copy of Horizon, so a swap is
// written into it like a payment is: the amount is held before the transaction
// is sent, and what the chain reports moved (and the fee, even when the
// conversion failed) is recorded afterwards.
import "server-only";
import type { Asset } from "@stellar/stellar-sdk";
import { Decimal, dec, displayAsset } from "@/lib/money";
import { isAssetEnabled, type PaymentAsset } from "@/lib/assets";
import { AppError, badRequest, conflict, notFound } from "@/lib/errors";
import { stellarTxUrl } from "@/lib/stellar-explorer";
import { audit } from "@/server/auth/audit";
import { db } from "@/server/db";
import { captureException } from "@/server/observability/error-tracking";
import { STELLAR_BASE_FEE_XLM } from "@/server/payments/quote";
import type { TxClient } from "@/server/payments/state-machine";
import { isAssetConfigured } from "@/server/stellar/assets";
import { findConversionRoute, findStrictSendPaths } from "@/server/stellar/paths";
import {
  SwapOutcomeUnknownError,
  walletService,
  type SwapLeg,
  type SwapResult,
} from "@/server/stellar/wallet";
import {
  creditAsset,
  debitAsset,
  getAssetBalance,
  releaseAsset,
  reserveAsset,
} from "@/server/wallet/balances";

export const SWAP_ASSETS = ["XLM", "USDC"] as const;
export type SwapAsset = (typeof SWAP_ASSETS)[number];
export type SwapMode = SwapLeg["mode"];

/** How far the price may move against the payer between the quote and the swap. */
const SLIPPAGE = dec("0.01");

// A swap writes up to three ledger entries. The transaction hash is unique on
// WalletTransaction, so one entry carries it and the others name it in the memo.
/** Memo of the entry that carries a swap's hash: what was spent, and into which asset. */
const SWAP_SENT_MEMO = "swap to ";
/** Memo of the entry for what the swap with this hash delivered. */
const receivedMemo = (txHash: string) => `swap ${txHash}`;

/** Why a swap was refused, in the error's details for the screen to act on. */
export type SwapRefusal =
  | "no_route"
  | "price_changed"
  | "payer_no_trustline"
  | "insufficient_balance"
  | "insufficient_fee"
  | "failed"
  | "unconfirmed";

export type SwapQuote = {
  from: SwapAsset;
  to: SwapAsset;
  mode: SwapMode;
  /** What the payer typed: the most of `from` the swap spends. */
  amount: Decimal;
  /** What the DEX gives for `amount` right now. */
  estimated: Decimal;
  /** The least of `to` the payer receives. A strict receive delivers exactly this. */
  minReceived: Decimal;
};

export type SwapOutcome = {
  txHash: string;
  from: SwapAsset;
  to: SwapAsset;
  sent: Decimal;
  received: Decimal;
};

export type SwapRecord = {
  /** The ledger entry that carries the hash. */
  id: string;
  txHash: string;
  from: PaymentAsset;
  sent: Decimal;
  /** Null when the entry for the received side is missing. */
  to: PaymentAsset | null;
  received: Decimal | null;
  createdAt: Date;
};

/** Swaps need both assets switched on and USDC's issuer known. */
export function swapsAvailable(): boolean {
  return SWAP_ASSETS.every((a) => isAssetEnabled(a) && isAssetConfigured(a));
}

export function swapCounterpart(from: SwapAsset): SwapAsset {
  return from === "XLM" ? "USDC" : "XLM";
}

function swapMode(from: SwapAsset): SwapMode {
  return from === "XLM" ? "strict_send" : "strict_receive";
}

function refused(reason: SwapRefusal, message: string, details: object = {}): AppError {
  return conflict(message, { reason, ...details });
}

function assertAvailable(): void {
  if (!swapsAvailable()) throw badRequest("Swaps are not available right now.");
}

const NO_ROUTE = "There are no offers to swap this amount right now. Try a smaller amount.";

/** What `amount` of `from` swaps into right now, and the least the payer would get. */
export async function quoteSwap(from: SwapAsset, amount: Decimal): Promise<SwapQuote> {
  assertAvailable();
  const to = swapCounterpart(from);
  const [best] = await findStrictSendPaths(from, to, amount);
  if (!best) throw refused("no_route", NO_ROUTE);
  const minReceived = best.destAmount
    .times(dec(1).minus(SLIPPAGE))
    .toDecimalPlaces(7, Decimal.ROUND_DOWN);
  // Too small to deliver even one stroop after the allowance.
  if (minReceived.lessThanOrEqualTo(0)) throw refused("no_route", NO_ROUTE);
  return { from, to, mode: swapMode(from), amount, estimated: best.destAmount, minReceived };
}

const PRICE_CHANGED = "The price changed. Check the new amount and swap again.";

/**
 * The path payment that honours what the payer was shown: at most `amount`
 * spent, at least `minReceived` received. Refused when the DEX no longer offers
 * that, so the payer sees a new quote instead of a transaction that fails.
 */
async function findRoute(
  from: SwapAsset,
  to: SwapAsset,
  amount: Decimal,
  minReceived: Decimal,
): Promise<{ leg: SwapLeg; path: Asset[] }> {
  if (swapMode(from) === "strict_send") {
    const [best] = await findStrictSendPaths(from, to, amount);
    if (!best || best.destAmount.lessThan(minReceived))
      throw refused("price_changed", PRICE_CHANGED);
    return {
      leg: { mode: "strict_send", sendAmount: amount, destMin: minReceived },
      path: best.path,
    };
  }
  const route = await findConversionRoute(from, to, minReceived);
  if (!route || route.sourceAmount.greaterThan(amount)) {
    throw refused("price_changed", PRICE_CHANGED);
  }
  return {
    leg: { mode: "strict_receive", sendMax: amount, destAmount: minReceived },
    path: route.path,
  };
}

/** What to tell the payer when the network took the swap and the conversion failed. */
function failureMessage(code: string | null, from: SwapAsset): string {
  switch (code) {
    case "op_under_dest_min":
    case "op_over_source_max":
      return "The price moved before the swap went through, so nothing was swapped. Check the new amount and swap again.";
    case "op_too_few_offers":
      return "There were not enough offers to swap this amount, so nothing was swapped. Try a smaller amount.";
    case "op_underfunded":
      return `Your wallet did not have enough ${from} it could spend, so nothing was swapped.`;
    default:
      return "The swap did not go through, so nothing was swapped.";
  }
}

/** Takes `spent` out of a hold of `held` and frees the rest. Returns the new balance. */
async function spendHold(
  tx: TxClient,
  walletId: string,
  asset: PaymentAsset,
  held: Decimal,
  spent: Decimal,
): Promise<Decimal> {
  const after = await debitAsset(tx, walletId, asset, spent);
  await releaseAsset(tx, walletId, asset, held.minus(spent));
  return after;
}

/** What a swap put on hold in the wallet before it was sent. */
type SwapHolds = {
  walletId: string;
  from: PaymentAsset;
  to: PaymentAsset;
  amount: Decimal;
  fee: Decimal;
};

/**
 * Writes a swap a ledger took into the wallet: its holds are spent or freed,
 * and `SWAP` entries record what the chain says moved.
 */
async function recordSwap(tx: TxClient, held: SwapHolds, result: SwapResult): Promise<void> {
  const { walletId, from, to, amount, fee } = held;
  const { txHash } = result;
  if (!result.ok) {
    // In a ledger, but the conversion failed: only the fee left the wallet.
    await releaseAsset(tx, walletId, from, amount);
    const xlmAfter = await spendHold(tx, walletId, "XLM", fee, result.feeXlm);
    await tx.walletTransaction.create({
      data: {
        walletId,
        type: "SWAP",
        asset: "XLM",
        amount: result.feeXlm.negated().toFixed(7),
        balanceAfter: xlmAfter.toFixed(7),
        stellarTxHash: txHash,
        memo: "failed swap network fee",
      },
    });
    return;
  }
  const fromAfter = await spendHold(tx, walletId, from, amount, result.sent);
  await tx.walletTransaction.create({
    data: {
      walletId,
      type: "SWAP",
      asset: from,
      amount: result.sent.negated().toFixed(7),
      balanceAfter: fromAfter.toFixed(7),
      stellarTxHash: txHash,
      memo: `${SWAP_SENT_MEMO}${to}`,
    },
  });
  const toAfter = await creditAsset(tx, walletId, to, result.received);
  await tx.walletTransaction.create({
    data: {
      walletId,
      type: "SWAP",
      asset: to,
      amount: result.received.toFixed(7),
      balanceAfter: toAfter.toFixed(7),
      memo: receivedMemo(txHash),
    },
  });
  const xlmAfter = await spendHold(tx, walletId, "XLM", fee, result.feeXlm);
  await tx.walletTransaction.create({
    data: {
      walletId,
      type: "SWAP",
      asset: "XLM",
      amount: result.feeXlm.negated().toFixed(7),
      balanceAfter: xlmAfter.toFixed(7),
      memo: `swap ${txHash} network fee`,
    },
  });
}

/**
 * Swaps up to `amount` of `from` for at least `minReceived` of the other asset,
 * the two numbers the payer confirmed. Throws a 409 with a `reason` when the
 * swap is refused or fails; in every such case nothing was converted.
 */
export async function executeSwap(input: {
  userId: string;
  from: SwapAsset;
  amount: Decimal;
  minReceived: Decimal;
}): Promise<SwapOutcome> {
  assertAvailable();
  const { from, amount, minReceived } = input;
  const to = swapCounterpart(from);
  const wallet = await db.custodialWallet.findUnique({ where: { userId: input.userId } });
  if (!wallet) throw notFound("wallet not found");

  // Both directions need the trustline: to receive USDC, or to hold any to send.
  if (!(await walletService.canReceive(wallet.stellarPublicKey, "USDC"))) {
    throw refused("payer_no_trustline", "Turn on USDC first.", { asset: "USDC" });
  }

  const { leg, path } = await findRoute(from, to, amount, minReceived);
  const fee = STELLAR_BASE_FEE_XLM;
  // The network keeps a minimum XLM balance in every account. It refuses a
  // transaction that would dip into it only after charging the fee.
  const locked = await walletService.lockedXlm(wallet.stellarPublicKey);

  await db.$transaction(async (tx) => {
    const xlm = await getAssetBalance(tx, wallet.id, "XLM");
    const spendableXlm = Decimal.max(xlm.available.minus(locked), 0);
    if (from === "XLM") {
      const max = Decimal.max(spendableXlm.minus(fee), 0);
      if (amount.greaterThan(max)) {
        throw refused(
          "insufficient_balance",
          `Not enough XLM. You can swap up to ${max.toFixed(7)} XLM; ` +
            `${locked.toFixed(1)} XLM stays in your wallet as the network's minimum balance.`,
          { asset: from, max: max.toFixed(7), lockedXlm: locked.toFixed(7) },
        );
      }
    } else {
      const source = await getAssetBalance(tx, wallet.id, from);
      if (amount.greaterThan(source.available)) {
        throw refused(
          "insufficient_balance",
          `Not enough ${from}. You can swap up to ${source.available.toFixed(7)} ${from}.`,
          { asset: from, max: source.available.toFixed(7) },
        );
      }
      if (spendableXlm.lessThan(fee)) {
        throw refused(
          "insufficient_fee",
          `Not enough XLM for the network fee. Add about ${fee.toFixed(7)} XLM.`,
          { requiredXlm: fee.toFixed(7) },
        );
      }
    }
    await reserveAsset(tx, wallet.id, from, amount);
    await reserveAsset(tx, wallet.id, "XLM", fee);
  });

  const releaseHolds = async (tx: TxClient) => {
    await releaseAsset(tx, wallet.id, from, amount);
    await releaseAsset(tx, wallet.id, "XLM", fee);
  };

  let result: SwapResult;
  try {
    result = await walletService.swap({
      encryptedSecret: wallet.encryptedSecret,
      sendAsset: from,
      destAsset: to,
      path,
      feeXlm: fee,
      ...leg,
    });
  } catch (err) {
    if (err instanceof SwapOutcomeUnknownError) {
      // The holds stay: the wallet must not spend what the swap may have spent.
      // The row is what lets resolveUnconfirmedSwaps settle them later.
      await db.unconfirmedSwap
        .create({
          data: {
            walletId: wallet.id,
            txHash: err.txHash,
            fromAsset: from,
            toAsset: to,
            heldAmount: amount.toFixed(7),
            heldFeeXlm: fee.toFixed(7),
          },
        })
        .catch((e: unknown) =>
          captureException(e, {
            source: "swap.unconfirmed",
            walletId: wallet.id,
            txHash: err.txHash,
          }),
        );
      captureException(err, { source: "swap", walletId: wallet.id, txHash: err.txHash });
      throw refused(
        "unconfirmed",
        "We could not confirm your swap. The amount is on hold while we check it. Please do not swap again yet.",
        { txHash: err.txHash },
      );
    }
    // It never reached a ledger: nothing moved and no fee was charged.
    await db.$transaction(releaseHolds);
    console.error("[swap] not submitted", { walletId: wallet.id, error: (err as Error).message });
    throw refused(
      "failed",
      "The swap did not go through, and nothing was taken from your wallet. Try again.",
    );
  }

  const { txHash } = result;
  await db.$transaction((tx) =>
    recordSwap(tx, { walletId: wallet.id, from, to, amount, fee }, result),
  );

  if (!result.ok) {
    throw refused("failed", failureMessage(result.failure, from), {
      txHash,
      code: result.failure,
    });
  }
  return { txHash, from, to, sent: result.sent, received: result.received };
}

// Cap Horizon lookups per run. What is left over is picked up by the next one.
const MAX_UNCONFIRMED_PER_RUN = 50;

/**
 * Settles the swaps whose outcome could not be read when they were sent. Each
 * is looked up by its hash again. One a ledger took is recorded the way
 * executeSwap would have recorded it; one no ledger can take any more has its
 * holds freed; one Horizon still cannot answer for waits for the next run.
 */
export async function resolveUnconfirmedSwaps(): Promise<{ checked: number; resolved: number }> {
  const open = await db.unconfirmedSwap.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "asc" },
    take: MAX_UNCONFIRMED_PER_RUN,
  });
  let resolved = 0;
  for (const swap of open) {
    try {
      const lookup = await walletService.swapOutcome(swap.txHash, swap.createdAt);
      if (lookup.state === "pending") continue;
      const outcome =
        lookup.state === "expired" ? "expired" : lookup.result.ok ? "swapped" : "failed";
      const held: SwapHolds = {
        walletId: swap.walletId,
        from: swap.fromAsset,
        to: swap.toAsset,
        amount: dec(swap.heldAmount.toString()),
        fee: dec(swap.heldFeeXlm.toString()),
      };
      const settled = await db.$transaction(async (tx) => {
        // Claimed first, so two runs cannot both settle the same holds.
        const claim = await tx.unconfirmedSwap.updateMany({
          where: { id: swap.id, resolvedAt: null },
          data: { resolvedAt: new Date(), outcome },
        });
        if (claim.count === 0) return false;
        if (lookup.state === "expired") {
          await releaseAsset(tx, held.walletId, held.from, held.amount);
          await releaseAsset(tx, held.walletId, "XLM", held.fee);
        } else {
          await recordSwap(tx, held, lookup.result);
        }
        return true;
      });
      if (!settled) continue;
      resolved++;
      await audit({
        action: "swap.unconfirmed.resolved",
        target: swap.walletId,
        metadata: { txHash: swap.txHash, outcome },
      });
    } catch (err) {
      captureException(err, {
        source: "swap.unconfirmed.resolve",
        walletId: swap.walletId,
        txHash: swap.txHash,
      });
    }
  }
  return { checked: open.length, resolved };
}

/** The payer's swaps, newest first, starting after the entry `cursor` names. */
async function findSwaps(
  userId: string,
  opts: { cursor?: string; take: number },
): Promise<SwapRecord[]> {
  const wallet = await db.custodialWallet.findUnique({ where: { userId } });
  if (!wallet) return [];
  const sent = await db.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      type: "SWAP",
      stellarTxHash: { not: null },
      memo: { startsWith: SWAP_SENT_MEMO },
    },
    orderBy: { createdAt: "desc" },
    take: opts.take,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const received = await db.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      type: "SWAP",
      memo: { in: sent.map((s) => receivedMemo(s.stellarTxHash!)) },
    },
  });
  const byMemo = new Map(received.map((r) => [r.memo, r]));
  return sent.map((s) => {
    const r = byMemo.get(receivedMemo(s.stellarTxHash!));
    return {
      id: s.id,
      txHash: s.stellarTxHash!,
      from: s.asset,
      sent: dec(s.amount.toString()).abs(),
      to: r?.asset ?? null,
      received: r ? dec(r.amount.toString()) : null,
      createdAt: s.createdAt,
    };
  });
}

/** The payer's latest swaps, newest first, each with the hash to look it up by. */
export async function getRecentSwaps(userId: string, limit = 10): Promise<SwapRecord[]> {
  return findSwaps(userId, { take: limit });
}

/** A swap as the history list shows it. */
export type PayerSwapListItem = {
  id: string;
  txUrl: string;
  sent: string;
  /** Null when the entry for the received side is missing. */
  received: string | null;
  createdAt: string;
};

/** One page of the payer's swaps for the history list, newest first. */
export async function getPayerSwaps(
  userId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: PayerSwapListItem[]; nextCursor?: string }> {
  const rows = await findSwaps(userId, { cursor: opts.cursor, take: opts.limit + 1 });
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const items = page.map((s) => ({
    id: s.id,
    txUrl: stellarTxUrl(s.txHash),
    sent: displayAsset(s.sent, s.from),
    received: s.received && s.to ? displayAsset(s.received, s.to) : null,
    createdAt: s.createdAt.toISOString(),
  }));
  return { items, nextCursor: hasMore ? page[page.length - 1]!.id : undefined };
}
