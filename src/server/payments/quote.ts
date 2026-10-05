// src/server/payments/quote.ts
import "server-only";
import { dec, phpToAsset, Decimal } from "@/lib/money";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { escrowAppliesTo, escrowFeeEstimateXlm } from "@/server/stellar/escrow-config";
import { withRetry } from "@/lib/retry";
import { AppError, badRequest, conflict, notFound } from "@/lib/errors";
import { assertAssetEnabled, isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { getAssetBalance } from "@/server/wallet/balances";
import { newPaymentReference } from "./reference";
import { resolveSettlementRoute, type RouteRefusal } from "./settlement-route";

// One Stellar payment operation costs the base fee of 100 stroops = 0.0000100 XLM.
// Fees are charged in XLM for every asset, so a USDC payment still needs a sliver
// of XLM in the wallet.
export const STELLAR_BASE_FEE_XLM: Decimal = dec("0.0000100");

export type CreateQuoteInput = {
  payerId: string;
  merchantId: string;
  amountPhp: Decimal;
  asset?: PaymentAsset;
};
export type CreateQuoteResult = {
  paymentId: string;
  reference: string;
  asset: PaymentAsset;
  amountPhp: Decimal;
  rate: Decimal;
  amountAsset: Decimal;
  networkFeeXlm: Decimal;
  /** The asset HeyPay receives — always the payer's own asset. */
  settlementAsset: PaymentAsset;
  quoteExpiresAt: Date;
};

export async function createQuote(input: CreateQuoteInput): Promise<CreateQuoteResult> {
  const asset: PaymentAsset = input.asset ?? "XLM";
  assertAssetEnabled(asset); // gated behind PAYMENT_ASSETS

  const merchant = await db.merchant.findUnique({ where: { id: input.merchantId } });
  if (!merchant || merchant.status !== "ACTIVE")
    throw notFound("merchant not available for payment");

  const wallet = await db.custodialWallet.findUnique({ where: { userId: input.payerId } });
  if (!wallet) throw conflict("payer wallet not found");

  // A price source refusing to quote (AppError) is final; only transient
  // failures are worth retrying.
  const quote = await withRetry(
    () => rail.getQuote({ sell: asset, buy: "PHP", phpAmount: input.amountPhp }),
    { label: "rail.getQuote", isRetryable: (err) => !(err instanceof AppError) },
  );
  const rate = quote.rate;
  // Computed here rather than taken from the rail: ROUND_UP at 7dp means the
  // payer always covers the merchant's full PHP amount, whatever the rail rounds.
  const amountAsset = phpToAsset(input.amountPhp, rate);

  // Refuse here, before the payer confirms, rather than fail on-chain later.
  const preflight = await resolveSettlementRoute({
    asset,
    amount: amountAsset,
    payerPublicKey: wallet.stellarPublicKey,
  });
  if (!preflight.ok) throw routeRefused(asset, preflight.reason);
  // The settle job delivers the payer's own asset and nothing else. A converting
  // route means the treasury cannot hold that asset, so there is no way to settle.
  if (preflight.route.mode !== "direct") throw routeRefused(asset, "destination_no_trustline");

  const networkFeeXlm = STELLAR_BASE_FEE_XLM;
  await assertFundsAvailable(wallet.id, asset, amountAsset, networkFeeXlm);

  const payment = await db.$transaction(async (tx) => {
    await tx.exchangeRateSnapshot.create({
      data: { pair: `${asset}PHP`, rate: rate.toFixed(8), source: quote.source },
    });
    const p = await tx.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: input.payerId,
        merchantId: input.merchantId,
        asset,
        amountPhp: input.amountPhp.toFixed(2),
        quotedRate: rate.toFixed(8),
        amountAsset: amountAsset.toFixed(7),
        settlementAsset: asset,
        networkFeeXlm: networkFeeXlm.toFixed(7),
        status: "QUOTED",
        quoteExpiresAt: quote.expiresAt,
      },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: p.id,
        fromStatus: "CREATED",
        toStatus: "QUOTED",
        detail: {
          asset,
          rate: rate.toFixed(8),
          rateSource: quote.source,
          ...(preflight.escrowId && { escrowId: preflight.escrowId }),
        },
      },
    });
    return p;
  });

  return {
    paymentId: payment.id,
    reference: payment.reference,
    asset,
    amountPhp: input.amountPhp,
    rate,
    amountAsset,
    networkFeeXlm,
    settlementAsset: asset,
    quoteExpiresAt: quote.expiresAt,
  };
}

/** Why a payment cannot settle, as the payer reads it on the confirm screen. */
const ROUTE_REFUSAL_MESSAGE: Record<RouteRefusal, (asset: PaymentAsset) => string> = {
  no_escrow: (asset) => `HeyPay cannot hold ${asset} payments in escrow right now.`,
  payer_no_trustline: (asset) =>
    `Your wallet is not set up to hold ${asset}. Turn on ${asset} on the Prefund page, then try again.`,
  destination_no_trustline: (asset) => `HeyPay cannot receive ${asset} payments right now.`,
  no_dex_path: (asset) =>
    `${asset} cannot be converted for this amount right now. Try a smaller amount or another asset.`,
};

function routeRefused(asset: PaymentAsset, reason: RouteRefusal): AppError {
  return badRequest(ROUTE_REFUSAL_MESSAGE[reason](asset), { asset, reason });
}

/**
 * A payment spends two balances when funded by an issued asset: `amountAsset` of
 * that asset, plus the XLM network fee. For XLM both legs come out of the same
 * balance and must be checked as one total.
 */
async function assertFundsAvailable(
  walletId: string,
  asset: PaymentAsset,
  amountAsset: Decimal,
  networkFeeXlm: Decimal,
): Promise<void> {
  if (!isIssuedAsset(asset)) {
    const { available } = await getAssetBalance(db, walletId, asset);
    // An escrowed payment also pays the deposit's Soroban resource fee, which is
    // only known once it lands; reserve the estimate so the deposit cannot fail
    // for want of it.
    const escrowFee = escrowAppliesTo(asset) ? escrowFeeEstimateXlm() : dec("0");
    const required = amountAsset.plus(networkFeeXlm).plus(escrowFee);
    if (available.lessThan(required)) {
      throw conflict("insufficient available XLM balance", {
        asset,
        available: available.toFixed(7),
        required: required.toFixed(7),
      });
    }
    return;
  }

  const [assetBalance, xlmBalance] = await Promise.all([
    getAssetBalance(db, walletId, asset),
    getAssetBalance(db, walletId, "XLM"),
  ]);
  if (assetBalance.available.lessThan(amountAsset)) {
    throw conflict(`insufficient available ${asset} balance`, {
      asset,
      available: assetBalance.available.toFixed(7),
      required: amountAsset.toFixed(7),
    });
  }
  if (xlmBalance.available.lessThan(networkFeeXlm)) {
    throw conflict("insufficient XLM to cover the Stellar network fee", {
      availableXlm: xlmBalance.available.toFixed(7),
      requiredXlm: networkFeeXlm.toFixed(7),
    });
  }
}
