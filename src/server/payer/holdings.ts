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
import { dec, type Decimal } from "@/lib/money";
import { enabledAssets, type PaymentAsset } from "@/lib/assets";
import { db } from "@/server/db";
import { isAssetConfigured } from "@/server/stellar/assets";
import { getAssetRate } from "@/server/payments/rate";
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
