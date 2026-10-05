// src/server/payments/settlement-route.ts
//
// Whether a payment in a given asset can settle, decided at quote time.
//
// Everything checked here is something the network would otherwise refuse only
// after the payer has confirmed: an escrow that is not deployed for the asset, a
// payer account that could not take the asset back in a refund, a destination
// that cannot hold the asset, or a DEX with no route when the asset would have
// to be converted on the way.
import "server-only";
import type { Asset } from "@stellar/stellar-sdk";
import type { Decimal } from "@/lib/money";
import { isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import { escrowAppliesTo, escrowContractId } from "@/server/stellar/escrow-config";
import { findStrictSendPaths } from "@/server/stellar/paths";

/** The asset every destination can receive: any existing account accepts XLM. */
const FALLBACK_ASSET: PaymentAsset = "XLM";

export type RouteRefusal =
  /** The escrow is on for this asset but no instance is deployed for it. */
  | "no_escrow"
  /** The payer's account holds no trustline for the asset. */
  | "payer_no_trustline"
  /** The destination cannot hold the asset, and converting it is not possible. */
  | "destination_no_trustline"
  /** The asset would have to be converted, and the DEX has no route for the amount. */
  | "no_dex_path";

export type SettlementPath =
  | {
      /** The destination receives the payer's own asset. */
      mode: "direct";
      settlementAsset: PaymentAsset;
      destination: string;
      memo: string | null;
    }
  | {
      /** The asset is converted on the DEX in the transaction that delivers it. */
      mode: "path";
      settlementAsset: PaymentAsset;
      destination: string;
      memo: string | null;
      /** How much of `settlementAsset` the amount buys along `path` right now. */
      destAmount: Decimal;
      path: Asset[];
    };

export type SettlementRoute =
  | { ok: true; reason: null; escrowId: string | null; route: SettlementPath }
  | { ok: false; reason: RouteRefusal; escrowId: string | null; route: null };

/**
 * How `amount` of `asset` from `payerPublicKey` would settle, or why it cannot.
 * `escrowId` is the contract that holds the crypto until the payout is known,
 * or null when the payment goes straight to the destination.
 */
export async function resolveSettlementRoute(input: {
  asset: PaymentAsset;
  /** How much of `asset` the payer sends. */
  amount: Decimal;
  payerPublicKey: string;
}): Promise<SettlementRoute> {
  const { asset, amount, payerPublicKey } = input;
  let escrowId: string | null = null;
  const refuse = (reason: RouteRefusal): SettlementRoute => ({
    ok: false,
    reason,
    escrowId,
    route: null,
  });

  if (escrowAppliesTo(asset)) {
    escrowId = escrowContractId(asset);
    if (!escrowId) return refuse("no_escrow");
  }

  const deposit = await rail.getDepositAddress(asset);
  const [payerHolds, destinationHolds] = await Promise.all([
    // A refund returns the same asset, so the payer must still be able to hold it.
    isIssuedAsset(asset) ? walletService.canReceive(payerPublicKey, asset) : true,
    walletService.canReceive(deposit.address, asset),
  ]);
  if (!payerHolds) return refuse("payer_no_trustline");
  if (destinationHolds) {
    return {
      ok: true,
      reason: null,
      escrowId,
      route: {
        mode: "direct",
        settlementAsset: asset,
        destination: deposit.address,
        memo: deposit.memo,
      },
    };
  }

  // The escrow releases its own token to the destination, so an escrowed asset
  // cannot be converted on the way: the destination has to hold it.
  if (escrowId || asset === FALLBACK_ASSET) return refuse("destination_no_trustline");
  if (!(await walletService.canReceive(deposit.address, FALLBACK_ASSET))) {
    return refuse("destination_no_trustline");
  }
  const [best] = await findStrictSendPaths(asset, FALLBACK_ASSET, amount);
  if (!best) return refuse("no_dex_path");
  return {
    ok: true,
    reason: null,
    escrowId,
    route: {
      mode: "path",
      settlementAsset: FALLBACK_ASSET,
      destination: deposit.address,
      memo: deposit.memo,
      destAmount: best.destAmount,
      path: best.path,
    },
  };
}
