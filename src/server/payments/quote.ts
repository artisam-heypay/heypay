// src/server/payments/quote.ts
import "server-only";
import { dec, phpToAsset, Decimal } from "@/lib/money";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { withRetry } from "@/lib/retry";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { assertAssetEnabled, isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { getAssetBalance } from "@/server/wallet/balances";
import { walletService } from "@/server/stellar/wallet";
import { getAssetRate } from "./rate";
import { newPaymentReference } from "./reference";

// One Stellar payment operation costs the base fee of 100 stroops = 0.0000100 XLM.
// Fees are charged in XLM for every asset, so a USDT payment still needs a sliver
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
  quoteExpiresAt: Date;
};

export async function createQuote(input: CreateQuoteInput): Promise<CreateQuoteResult> {
  const asset: PaymentAsset = input.asset ?? "XLM";
  assertAssetEnabled(asset); // gated behind PAYMENT_ASSETS
  if (!rail.supportsAsset(asset)) {
    throw badRequest(`The payment rail cannot settle ${asset}.`, { asset });
  }
  await assertRailCanReceive(asset);
  await assertAboveRailMinimum(asset, input.amountPhp);

  const merchant = await db.merchant.findUnique({ where: { id: input.merchantId } });
  if (!merchant || merchant.status !== "ACTIVE")
    throw notFound("merchant not available for payment");

  const wallet = await db.custodialWallet.findUnique({ where: { userId: input.payerId } });
  if (!wallet) throw conflict("payer wallet not found");

  const quote = await withRetry(
    () => rail.getQuote({ sell: asset, buy: "PHP", phpAmount: input.amountPhp }),
    { label: "rail.getQuote" },
  );
  const rate = quote.rate;
  const amountAsset = phpToAsset(input.amountPhp, rate); // ROUND_UP, 7dp (payer covers)
  const networkFeeXlm = STELLAR_BASE_FEE_XLM;

  await assertFundsAvailable(wallet.id, asset, amountAsset, networkFeeXlm);

  const payment = await db.$transaction(async (tx) => {
    await tx.exchangeRateSnapshot.create({
      data: { pair: `${asset}PHP`, rate: rate.toFixed(8), source: "PDAX" },
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
        detail: { asset, rate: rate.toFixed(8) },
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
    quoteExpiresAt: quote.expiresAt,
  };
}

/**
 * Refuse to quote an asset the rail's deposit account cannot actually receive.
 *
 * Stellar rejects a payment to an account that doesn't trust the asset — but it
 * does so at submission, by which point the payer has confirmed and we are one
 * step from moving money. Checking the destination up front turns a mid-flight
 * `op_no_trust` failure into a plain "we can't take USDC yet" at quote time.
 */
async function assertRailCanReceive(asset: PaymentAsset): Promise<void> {
  let destination: string;
  try {
    destination = (await rail.getDepositAddress(asset)).address;
  } catch {
    throw badRequest(`The payment rail has no ${asset} deposit wallet.`, { asset });
  }
  if (!(await walletService.canReceive(destination, asset))) {
    throw badRequest(`The payment rail cannot receive ${asset} on this network yet.`, {
      asset,
      destination,
    });
  }
}

/**
 * Exchanges enforce a minimum *crypto* order size, so the PHP floor moves with
 * the rate. Converting the floor here lets us name the amount the payer needs
 * instead of surfacing PDAX's "Order quantity is less than minimum required
 * quantity" from a failed quote.
 */
async function assertAboveRailMinimum(asset: PaymentAsset, amountPhp: Decimal): Promise<void> {
  const minAsset = rail.minSellAmount(asset);
  if (!minAsset) return;
  const rate = await getAssetRate(asset);
  if (!rate) return; // no rate to convert with; the rail will reject it if too small
  const estimated = phpToAsset(amountPhp, rate);
  if (estimated.greaterThanOrEqualTo(minAsset)) return;
  const minPhp = minAsset.times(rate).toDecimalPlaces(2, Decimal.ROUND_UP);
  throw badRequest(
    `The minimum ${asset} payment is ${minAsset.toString()} ${asset} (about ₱${minPhp.toFixed(2)}).`,
    { asset, minAsset: minAsset.toString(), minPhp: minPhp.toFixed(2) },
  );
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
