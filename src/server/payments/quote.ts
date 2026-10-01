// src/server/payments/quote.ts
import "server-only";
import { dec, phpToAsset, Decimal } from "@/lib/money";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { withRetry } from "@/lib/retry";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { assertAssetEnabled, isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { getAssetBalance } from "@/server/wallet/balances";
import { resolveSettlementRoute, quoteConversion } from "./settlement-route";
import { getAssetRate } from "./rate";
import { newPaymentReference } from "./reference";

// One Stellar payment operation costs the base fee of 100 stroops = 0.0000100 XLM.
// Fees are charged in XLM for every asset, so a USDT payment still needs a sliver
// of XLM in the wallet.
export const STELLAR_BASE_FEE_XLM: Decimal = dec("0.0000100");

/**
 * Head-room over the DEX quote when a payment converts on the way to the rail.
 * The order book moves between quoting and submitting; without this the path
 * payment fails (op_under_dest_min) and the payer just sees an error. The unused
 * remainder is delivered to the rail, not kept.
 */
const CONVERSION_SLIPPAGE = dec(process.env.SETTLEMENT_SLIPPAGE_BPS ?? "100").div(10_000);

/**
 * How far above the reference rate a DEX conversion may cost the payer before it
 * is refused (default 5%).
 *
 * A thin or manipulated order book can quote any price. Costing *less* than the
 * reference is harmless — the counterparty subsidises the payer, and the rail
 * still receives the full amount the merchant is owed — so only the expensive
 * side is capped. Without this, a bad book could silently charge a payer many
 * times what their asset is worth.
 */
const MAX_CONVERSION_PREMIUM = dec(process.env.SETTLEMENT_MAX_PREMIUM_BPS ?? "500").div(10_000);

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
  /** The asset the rail receives; differs from `asset` when the payment converts. */
  settlementAsset: PaymentAsset;
  quoteExpiresAt: Date;
};

export async function createQuote(input: CreateQuoteInput): Promise<CreateQuoteResult> {
  const asset: PaymentAsset = input.asset ?? "XLM";
  assertAssetEnabled(asset); // gated behind PAYMENT_ASSETS

  // How this asset reaches the rail — directly, or converted on the DEX. Decided
  // before anything is priced, because it changes what gets priced.
  const route = await resolveSettlementRoute(asset);
  const settlementAsset = route.settlementAsset;

  const merchant = await db.merchant.findUnique({ where: { id: input.merchantId } });
  if (!merchant || merchant.status !== "ACTIVE")
    throw notFound("merchant not available for payment");

  const wallet = await db.custodialWallet.findUnique({ where: { userId: input.payerId } });
  if (!wallet) throw conflict("payer wallet not found");

  // The rail always quotes and sells the asset it receives.
  await assertAboveRailMinimum(settlementAsset, input.amountPhp);
  const quote = await withRetry(
    () => rail.getQuote({ sell: settlementAsset, buy: "PHP", phpAmount: input.amountPhp }),
    { label: "rail.getQuote" },
  );

  // The rail needs this much of `settlementAsset` to cover the merchant's PHP.
  const settlementAmount = phpToAsset(input.amountPhp, quote.rate); // ROUND_UP, 7dp

  let amountAsset: Decimal;
  let rate: Decimal;
  if (route.mode === "direct") {
    amountAsset = settlementAmount;
    rate = quote.rate;
  } else {
    // Convert on the DEX: price the payer's asset by what it costs to deliver
    // `settlementAmount`, plus head-room for the book moving before submission.
    const conversion = await quoteConversion(asset, route, settlementAmount);
    const dexCost = conversion.sourceAmount
      .times(dec(1).plus(CONVERSION_SLIPPAGE))
      .toDecimalPlaces(7, Decimal.ROUND_UP);
    await assertConversionNotOverpriced(asset, input.amountPhp, dexCost);
    amountAsset = await chargeAtLeastMarketPrice(asset, input.amountPhp, dexCost);
    // The payer's effective rate: what one unit of their asset buys in PHP.
    rate = input.amountPhp.div(amountAsset).toDecimalPlaces(8, Decimal.ROUND_DOWN);
  }

  const networkFeeXlm = STELLAR_BASE_FEE_XLM;
  await assertFundsAvailable(wallet.id, asset, amountAsset, networkFeeXlm);

  const payment = await db.$transaction(async (tx) => {
    await tx.exchangeRateSnapshot.create({
      data: {
        pair: `${settlementAsset}PHP`,
        rate: quote.rate.toFixed(8),
        source: "PDAX",
      },
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
        settlementAsset,
        // Only meaningful when the payment converts; a direct one settles in
        // `amountAsset` itself.
        settlementAmount: route.mode === "path" ? settlementAmount.toFixed(7) : null,
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
          settlementAsset,
          settlementMode: route.mode,
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
    settlementAsset,
    quoteExpiresAt: quote.expiresAt,
  };
}

/**
 * The payer is charged the market price of their asset, never the DEX's.
 *
 * A thin order book can be mispriced in the payer's favour as easily as against
 * them — testnet currently sells XLM so cheaply that ₱197 costs 0.0005 USDC,
 * implying a rate of ₱406,101 per USDC. Quoting that is nonsense on the confirm
 * screen and would be a windfall taken from whoever posted the stale offer.
 *
 * So the debit is the greater of what the DEX asks and what the asset is worth.
 * The rail still receives exactly `settlementAmount`; any surplus the conversion
 * yields lands in HeyPay's own rail balance, not a counterparty's pocket.
 * (The expensive side is capped separately — see MAX_CONVERSION_PREMIUM.)
 */
async function chargeAtLeastMarketPrice(
  asset: PaymentAsset,
  amountPhp: Decimal,
  dexCost: Decimal,
): Promise<Decimal> {
  const referenceRate = await getAssetRate(asset);
  if (!referenceRate) return dexCost; // no market price to compare against
  const marketAmount = phpToAsset(amountPhp, referenceRate);
  return dexCost.greaterThan(marketAmount) ? dexCost : marketAmount;
}

/**
 * Refuse a DEX conversion that would charge the payer materially more than their
 * asset is worth. Cheaper than reference is allowed — see MAX_CONVERSION_PREMIUM.
 */
async function assertConversionNotOverpriced(
  asset: PaymentAsset,
  amountPhp: Decimal,
  amountAsset: Decimal,
): Promise<void> {
  const referenceRate = await getAssetRate(asset);
  if (!referenceRate) return; // nothing to compare against
  const fairAmount = phpToAsset(amountPhp, referenceRate);
  const maxAmount = fairAmount.times(dec(1).plus(MAX_CONVERSION_PREMIUM));
  if (amountAsset.lessThanOrEqualTo(maxAmount)) return;
  throw badRequest(
    `Converting ${asset} on the Stellar DEX currently costs ${amountAsset.toFixed(7)} ${asset}, ` +
      `far above the ${fairAmount.toFixed(7)} ${asset} this payment is worth. Try again later.`,
    { asset, quoted: amountAsset.toFixed(7), fair: fairAmount.toFixed(7) },
  );
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
    `The minimum payment is about ₱${minPhp.toFixed(2)} (${minAsset.toString()} ${asset}).`,
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
