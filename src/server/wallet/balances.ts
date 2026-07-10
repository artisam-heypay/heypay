// src/server/wallet/balances.ts
//
// The single accessor for custodial-wallet balances, keyed by asset.
//
// Storage is split: native XLM lives on `CustodialWallet.cachedXlmBalance` /
// `reservedXlm` (where it has always lived), while issued assets get a row per
// (wallet, asset) in `WalletBalance`. Callers never see that split — they ask
// for an asset and get `{ cached, reserved, available }` back. Keeping XLM in
// its original columns means the XLM pipeline, its ledger history and the
// reconcile job are byte-for-byte unchanged by multi-asset support.
//
// Every mutator takes a `TxClient` so reservations, debits and credits compose
// inside the same transaction as the payment-state transition that justifies
// them. Balances are stored as 7-dp decimal strings, matching Stellar.
import "server-only";
import { availableAmount, dec, formatAsset, type Decimal } from "@/lib/money";
import { isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { db } from "@/server/db";
import type { TxClient } from "@/server/payments/state-machine";

export type WalletAssetBalance = {
  asset: PaymentAsset;
  cached: Decimal;
  reserved: Decimal;
  available: Decimal;
  /** Null for XLM (no trustline needed) and for issued assets not yet trusted. */
  trustlineEstablishedAt: Date | null;
  /** Whether the wallet can receive this asset today. */
  canReceive: boolean;
};

type Client = TxClient | typeof db;

const ZERO = dec("0");

/** Read one asset's balance. Creates no rows. */
export async function getAssetBalance(
  client: Client,
  walletId: string,
  asset: PaymentAsset,
): Promise<WalletAssetBalance> {
  if (!isIssuedAsset(asset)) {
    const w = await client.custodialWallet.findUniqueOrThrow({ where: { id: walletId } });
    const cached = dec(w.cachedXlmBalance.toString());
    const reserved = dec(w.reservedXlm.toString());
    return {
      asset,
      cached,
      reserved,
      available: availableAmount(cached, reserved),
      trustlineEstablishedAt: null,
      canReceive: true,
    };
  }
  const row = await client.walletBalance.findUnique({
    where: { walletId_asset: { walletId, asset } },
  });
  const cached = row ? dec(row.cached.toString()) : ZERO;
  const reserved = row ? dec(row.reserved.toString()) : ZERO;
  return {
    asset,
    cached,
    reserved,
    available: availableAmount(cached, reserved),
    trustlineEstablishedAt: row?.trustlineEstablishedAt ?? null,
    canReceive: row?.trustlineEstablishedAt != null,
  };
}

/** Read several assets' balances in listing order. */
export async function getAssetBalances(
  client: Client,
  walletId: string,
  assets: readonly PaymentAsset[],
): Promise<WalletAssetBalance[]> {
  const out: WalletAssetBalance[] = [];
  for (const asset of assets) out.push(await getAssetBalance(client, walletId, asset));
  return out;
}

async function writeBalance(
  tx: TxClient,
  walletId: string,
  asset: PaymentAsset,
  next: { cached?: Decimal; reserved?: Decimal },
): Promise<void> {
  if (!isIssuedAsset(asset)) {
    await tx.custodialWallet.update({
      where: { id: walletId },
      data: {
        ...(next.cached ? { cachedXlmBalance: formatAsset(next.cached) } : {}),
        ...(next.reserved ? { reservedXlm: formatAsset(next.reserved) } : {}),
      },
    });
    return;
  }
  await tx.walletBalance.upsert({
    where: { walletId_asset: { walletId, asset } },
    create: {
      walletId,
      asset,
      cached: formatAsset(next.cached ?? ZERO),
      reserved: formatAsset(next.reserved ?? ZERO),
    },
    update: {
      ...(next.cached ? { cached: formatAsset(next.cached) } : {}),
      ...(next.reserved ? { reserved: formatAsset(next.reserved) } : {}),
    },
  });
}

/** Hold `amount` of `asset` against in-flight payments. Caller checks availability first. */
export async function reserveAsset(
  tx: TxClient,
  walletId: string,
  asset: PaymentAsset,
  amount: Decimal,
): Promise<void> {
  if (amount.lessThanOrEqualTo(0)) return;
  const { reserved } = await getAssetBalance(tx, walletId, asset);
  await writeBalance(tx, walletId, asset, { reserved: reserved.plus(amount) });
}

/** Release a hold. Floors at zero: a double-release must not mint available balance. */
export async function releaseAsset(
  tx: TxClient,
  walletId: string,
  asset: PaymentAsset,
  amount: Decimal,
): Promise<void> {
  if (amount.lessThanOrEqualTo(0)) return;
  const { reserved } = await getAssetBalance(tx, walletId, asset);
  const next = reserved.minus(amount);
  await writeBalance(tx, walletId, asset, { reserved: next.isNegative() ? ZERO : next });
}

/**
 * Debit `amount` and release the matching reservation in one step (the settled
 * half of a reserve→debit pair). Returns the new cached balance.
 */
export async function debitAsset(
  tx: TxClient,
  walletId: string,
  asset: PaymentAsset,
  amount: Decimal,
): Promise<Decimal> {
  const { cached, reserved } = await getAssetBalance(tx, walletId, asset);
  const nextCached = cached.minus(amount);
  const nextReserved = reserved.minus(amount);
  await writeBalance(tx, walletId, asset, {
    cached: nextCached,
    reserved: nextReserved.isNegative() ? ZERO : nextReserved,
  });
  return nextCached;
}

/** Credit `amount` (deposit or refund). Returns the new cached balance. */
export async function creditAsset(
  tx: TxClient,
  walletId: string,
  asset: PaymentAsset,
  amount: Decimal,
): Promise<Decimal> {
  const { cached } = await getAssetBalance(tx, walletId, asset);
  const next = cached.plus(amount);
  await writeBalance(tx, walletId, asset, { cached: next });
  return next;
}

/**
 * Record that the wallet holds a trustline to `asset`'s issuer. Idempotent: the
 * first timestamp wins, so re-running trustline setup doesn't rewrite history.
 */
export async function markTrustlineEstablished(
  walletId: string,
  asset: PaymentAsset,
  at: Date = new Date(),
): Promise<void> {
  if (!isIssuedAsset(asset)) return;
  const existing = await db.walletBalance.findUnique({
    where: { walletId_asset: { walletId, asset } },
    select: { trustlineEstablishedAt: true },
  });
  if (existing?.trustlineEstablishedAt) return;
  await db.walletBalance.upsert({
    where: { walletId_asset: { walletId, asset } },
    create: { walletId, asset, trustlineEstablishedAt: at },
    update: { trustlineEstablishedAt: at },
  });
}
