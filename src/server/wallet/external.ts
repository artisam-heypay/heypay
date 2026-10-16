// src/server/wallet/external.ts
//
// The payer's own wallet: a payer can connect an account they hold the key to
// (Freighter) and choose to sign their escrow deposits with it. HeyPay stores
// that account's public key and nothing else of it. Everyone who does not opt
// in keeps the custodial wallet.
import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import type { WalletMode } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { badRequest, conflict } from "@/lib/errors";
import { audit } from "@/server/auth/audit";

export type OwnWallet = { walletMode: WalletMode; externalPublicKey: string | null };

/** Whether payers are offered their own wallet at all. Off unless set to "true". */
export function nonCustodialEnabled(): boolean {
  return process.env.NONCUSTODIAL_ENABLED === "true";
}

/**
 * The account a payer's payments come from when they chose their own wallet,
 * or null when the custodial wallet pays: the payer never opted in, or the
 * feature is off.
 */
export function ownWalletAccount(payer: OwnWallet): string | null {
  if (!nonCustodialEnabled() || payer.walletMode !== "EXTERNAL") return null;
  return payer.externalPublicKey;
}

const select = { walletMode: true, externalPublicKey: true } as const;

/** The payer's wallet choice and the account they connected, if any. */
export async function getOwnWallet(userId: string): Promise<OwnWallet> {
  return db.user.findUniqueOrThrow({ where: { id: userId }, select });
}

/**
 * Stores the account the payer's wallet reported and turns their own wallet
 * on: connecting is the opt-in. No signature is asked for. The key only ever
 * becomes the source of transactions the payer must then sign, so a key that
 * is not theirs gets them nothing.
 */
export async function connectOwnWallet(input: {
  userId: string;
  publicKey: string;
  ip?: string;
}): Promise<OwnWallet> {
  const { userId, publicKey } = input;
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw badRequest("That is not a Stellar account address.");
  }
  // An account HeyPay holds the key to is not the payer's own wallet, and its
  // balance is already tracked as someone's custodial wallet.
  const custodial = await db.custodialWallet.findUnique({
    where: { stellarPublicKey: publicKey },
    select: { id: true },
  });
  if (custodial || publicKey === process.env.HEYPAY_TREASURY_PUBLIC_KEY) {
    throw conflict("That account is a HeyPay wallet. Connect a wallet you hold the key to.");
  }

  const wallet = await db.user.update({
    where: { id: userId },
    data: { externalPublicKey: publicKey, walletMode: "EXTERNAL" },
    select,
  });
  await audit({
    actorId: userId,
    action: "wallet.external_connected",
    target: userId,
    metadata: { externalPublicKey: publicKey },
    ip: input.ip,
  });
  return wallet;
}

/** Switches between the custodial wallet and the connected one. */
export async function setWalletMode(input: {
  userId: string;
  walletMode: WalletMode;
  ip?: string;
}): Promise<OwnWallet> {
  const { userId, walletMode } = input;
  if (walletMode === "EXTERNAL") {
    // Only while a wallet is connected, checked in the same statement so a
    // disconnect at the same moment cannot leave the mode on with no account.
    const changed = await db.user.updateMany({
      where: { id: userId, externalPublicKey: { not: null } },
      data: { walletMode },
    });
    if (changed.count === 0) throw conflict("Connect your wallet first.");
  } else {
    await db.user.update({ where: { id: userId }, data: { walletMode } });
  }
  await audit({
    actorId: userId,
    action: "wallet.mode_changed",
    target: userId,
    metadata: { walletMode },
    ip: input.ip,
  });
  return getOwnWallet(userId);
}

/** Forgets the connected account and returns the payer to the custodial wallet. */
export async function disconnectOwnWallet(input: {
  userId: string;
  ip?: string;
}): Promise<OwnWallet> {
  const wallet = await db.user.update({
    where: { id: input.userId },
    data: { externalPublicKey: null, walletMode: "CUSTODIAL" },
    select,
  });
  await audit({
    actorId: input.userId,
    action: "wallet.external_disconnected",
    target: input.userId,
    ip: input.ip,
  });
  return wallet;
}
