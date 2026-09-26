// src/server/payments/quote.ts
import "server-only";
import { dec, phpToAsset, Decimal } from "@/lib/money";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import { withRetry } from "@/lib/retry";
import { AppError, badRequest, conflict, notFound } from "@/lib/errors";
import { assertAssetEnabled, isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { getAssetBalance } from "@/server/wallet/balances";
import { newPaymentReference } from "./reference";

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

  // Refuse here, before the payer confirms, rather than fail on-chain later.
  await assertTreasuryAccepts(asset);

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
        detail: { asset, rate: rate.toFixed(8), rateSource: quote.source },
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

/**
 * The treasury must exist and, for an issued asset, hold a trustline to it — the
 * network rejects anything else, and it would do so only after the payer had
 * confirmed.
 */
async function assertTreasuryAccepts(asset: PaymentAsset): Promise<void> {
  const deposit = await rail.getDepositAddress(asset);
  if (!(await walletService.canReceive(deposit.address, asset))) {
    throw badRequest(`HeyPay cannot receive ${asset} payments right now.`, { asset });
  }
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
    const required = amountAsset.plus(networkFeeXlm);
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
