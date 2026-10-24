// src/server/payer/holdings.ts
//
// The payer's portfolio: what they hold, what each token is worth in PHP, and
// what the lot adds up to.
//
// A token's PHP value needs a rate, and a rate needs a rail that can price the
// pair. When one is missing the token is still shown — the balance is real —
// but its value is null and it is excluded from the total, so the total never
// understates itself by silently counting an unpriced token as zero.
import "server-only";
import { dec, Decimal } from "@/lib/money";
import { enabledAssets, isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import type { HoldingsSnapshot } from "@/components/payer/HoldingsLive";
import { db } from "@/server/db";
import { isAssetConfigured } from "@/server/stellar/assets";
import { escrowAppliesTo, escrowFeeEstimateXlm } from "@/server/stellar/escrow-config";
import { walletService } from "@/server/stellar/wallet";
import { getAssetRate } from "@/server/payments/rate";
import { STELLAR_BASE_FEE_XLM } from "@/server/payments/quote";
import { getAssetBalances } from "@/server/wallet/balances";

export type Holding = {
  asset: PaymentAsset;
  /** Total held, including anything reserved by an in-flight payment. */
  balance: Decimal;
  reserved: Decimal;
  available: Decimal;
  /** 1 unit of `asset` in PHP; null when the rail cannot price the pair. */
  rate: Decimal | null;
  /** `balance` × `rate`; null when there is no rate. */
  valuePhp: Decimal | null;
  /** Issued assets the wallet has not trusted yet cannot receive deposits. */
  canReceive: boolean;
};

export type Holdings = {
  publicKey: string;
  tokens: Holding[];
  /** Sum of every priced token's value. */
  totalPhp: Decimal;
  /** True when some held token has no rate, so `totalPhp` is not the whole story. */
  hasUnpricedBalance: boolean;
};

export async function getHoldings(payerId: string): Promise<Holdings | null> {
  const wallet = await db.custodialWallet.findUnique({ where: { userId: payerId } });
  if (!wallet) return null;

  const assets = enabledAssets().filter(isAssetConfigured);
  const balances = await getAssetBalances(db, wallet.id, assets);

  const tokens: Holding[] = await Promise.all(
    balances.map(async (b) => {
      const rate = await getAssetRate(b.asset);
      return {
        asset: b.asset,
        balance: b.cached,
        reserved: b.reserved,
        available: b.available,
        rate,
        valuePhp: rate ? b.cached.times(rate) : null,
        canReceive: b.canReceive,
      };
    }),
  );

  const totalPhp = tokens.reduce((sum, t) => (t.valuePhp ? sum.plus(t.valuePhp) : sum), dec("0"));
  const hasUnpricedBalance = tokens.some((t) => t.valuePhp === null && t.balance.greaterThan(0));

  return { publicKey: wallet.stellarPublicKey, tokens, totalPhp, hasUnpricedBalance };
}

/**
 * What the payer's own wallet holds, read from the chain: HeyPay keeps no
 * balance for it and holds no key to it. Priced like the HeyPay wallet. A
 * token's `available` is what a payment can use now, as a quote checks it: for
 * XLM, the balance less the network's minimum balance and the fees the payer's
 * wallet pays for a payment, which `reserved` holds. An account that is not on
 * the network yet holds nothing. Throws when the chain cannot be read.
 */
export async function getOwnWalletHoldings(account: string): Promise<Holdings> {
  const assets = enabledAssets().filter(isAssetConfigured);
  const [onChain, locked] = await Promise.all([
    walletService.getBalances(account, assets),
    walletService.lockedXlm(account),
  ]);
  const xlmFees = STELLAR_BASE_FEE_XLM.plus(
    escrowAppliesTo("XLM") ? escrowFeeEstimateXlm() : dec("0"),
  );

  const tokens: Holding[] = await Promise.all(
    onChain.map(async (b) => {
      const rate = await getAssetRate(b.asset);
      const available = isIssuedAsset(b.asset)
        ? b.balance
        : Decimal.max(b.balance.minus(locked).minus(xlmFees), 0);
      return {
        asset: b.asset,
        balance: b.balance,
        reserved: b.balance.minus(available),
        available,
        rate,
        valuePhp: rate ? b.balance.times(rate) : null,
        canReceive: b.trustline,
      };
    }),
  );

  const totalPhp = tokens.reduce((sum, t) => (t.valuePhp ? sum.plus(t.valuePhp) : sum), dec("0"));
  const hasUnpricedBalance = tokens.some((t) => t.valuePhp === null && t.balance.greaterThan(0));
  return { publicKey: account, tokens, totalPhp, hasUnpricedBalance };
}

/** Holdings as a page shows them: strings instead of Decimals. */
export function holdingsSnapshot(holdings: Holdings | null): HoldingsSnapshot {
  return {
    totalPhp: holdings?.totalPhp.toFixed(2) ?? "0.00",
    hasUnpricedBalance: holdings?.hasUnpricedBalance ?? false,
    tokens: (holdings?.tokens ?? []).map((t) => ({
      asset: t.asset,
      balance: t.balance.toFixed(7),
      available: t.available.toFixed(7),
      valuePhp: t.valuePhp?.toFixed(2) ?? null,
      rate: t.rate?.toFixed(8) ?? null,
      canReceive: t.canReceive,
    })),
  };
}
