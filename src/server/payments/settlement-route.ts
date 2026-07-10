// src/server/payments/settlement-route.ts
//
// How a payer's asset reaches the rail.
//
// The rail can only sell what it can receive, and an exchange's deposit wallet
// is a real Stellar account: it exists (or doesn't) and trusts an asset (or
// doesn't). PDAX's UAT wallet, for instance, accepts XLM but holds no USDC
// trustline and has no USDT wallet at all.
//
// So there are two ways to settle:
//
//   direct — the rail has a wallet for the asset and can trade the pair; send it
//            straight there.
//   path   — convert the asset into one the rail does accept (XLM) on the
//            Stellar DEX, in the same transaction that delivers it. The rail
//            never sees the original asset; the payer's wallet is debited once.
//
// Choosing here, at quote time, is what turns a mid-flight `op_no_trust` into a
// plain refusal before the payer has confirmed anything.
import "server-only";
import { Asset } from "@stellar/stellar-sdk";
import { badRequest } from "@/lib/errors";
import type { Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";
import { rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import { findConversionRoute } from "@/server/stellar/paths";

/** The asset every rail we support can receive and trade. */
const FALLBACK_ASSET: PaymentAsset = "XLM";

export type DirectRoute = {
  mode: "direct";
  /** What the rail receives and sells: the payer's own asset. */
  settlementAsset: PaymentAsset;
  destination: string;
  memo: string | null;
};

export type PathRoute = {
  mode: "path";
  /** What the rail receives and sells after on-chain conversion. */
  settlementAsset: PaymentAsset;
  destination: string;
  memo: string | null;
};

export type SettlementRoute = DirectRoute | PathRoute;

/** Whether the rail's deposit account for `asset` exists and accepts it. */
async function railAccepts(
  asset: PaymentAsset,
): Promise<{ address: string; memo: string | null } | null> {
  if (!rail.supportsAsset(asset)) return null;
  let deposit: { address: string; memo: string | null };
  try {
    deposit = await rail.getDepositAddress(asset);
  } catch {
    return null; // no deposit wallet for this asset
  }
  if (!(await walletService.canReceive(deposit.address, asset))) return null;
  return deposit;
}

/**
 * Decide how `asset` will reach the rail, or refuse. Never returns a route the
 * chain would reject.
 */
export async function resolveSettlementRoute(asset: PaymentAsset): Promise<SettlementRoute> {
  const direct = await railAccepts(asset);
  if (direct) {
    return {
      mode: "direct",
      settlementAsset: asset,
      destination: direct.address,
      memo: direct.memo,
    };
  }

  // The rail can't take this asset. Fall back to converting it on the DEX into
  // one it can — but only if the rail can actually receive *that*.
  if (asset === FALLBACK_ASSET) {
    throw badRequest(`The payment rail cannot receive ${asset} on this network.`, { asset });
  }
  const viaXlm = await railAccepts(FALLBACK_ASSET);
  if (!viaXlm) {
    throw badRequest(`The payment rail cannot receive ${asset} on this network.`, { asset });
  }
  return {
    mode: "path",
    settlementAsset: FALLBACK_ASSET,
    destination: viaXlm.address,
    memo: viaXlm.memo,
  };
}

export type Conversion = { sourceAmount: Decimal; path: Asset[] };

/**
 * What the payer must send so `destAmount` of `route.settlementAsset` arrives.
 *
 * Refuses when the DEX has no route with enough depth: submitting anyway would
 * fail on-chain after the payer confirmed, or worse, deliver less than the rail
 * needs to cover the merchant.
 */
export async function quoteConversion(
  asset: PaymentAsset,
  route: PathRoute,
  destAmount: Decimal,
): Promise<Conversion> {
  const found = await findConversionRoute(asset, route.settlementAsset, destAmount);
  if (!found) {
    throw badRequest(
      `No route to convert ${asset} into ${route.settlementAsset} for this amount. ` +
        `The Stellar DEX has too little ${asset} liquidity right now.`,
      { asset, via: route.settlementAsset, destAmount: destAmount.toFixed(7) },
    );
  }
  return { sourceAmount: found.sourceAmount, path: found.path };
}
