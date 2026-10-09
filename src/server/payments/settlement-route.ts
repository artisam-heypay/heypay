// src/server/payments/settlement-route.ts
//
// Whether a payment in a given asset can settle, decided at quote time.
//
// The order of the checks and what each refusal means live in the MIT package
// `@heypay/settlement-route` (packages/settlement-route). This file gives it
// HeyPay's answers: the payout rail's deposit address, Horizon through the
// wallet service, the escrow instances and the DEX path finder.
import "server-only";
import type { Asset } from "@stellar/stellar-sdk";
import {
  createSettlementRouteResolver,
  type SettlementPath as Path,
  type SettlementRoute as Route,
} from "@heypay/settlement-route";
import type { Decimal } from "@/lib/money";
import { isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import { escrowHoldsAsset } from "@/server/stellar/escrow";
import { escrowAppliesTo, escrowContractId } from "@/server/stellar/escrow-config";
import { findStrictSendPaths } from "@/server/stellar/paths";

export type { RouteRefusal } from "@heypay/settlement-route";
export type SettlementPath = Path<PaymentAsset, Decimal, Asset>;
export type SettlementRoute = Route<PaymentAsset, Decimal, Asset>;

/**
 * How `amount` of `asset` from `payerPublicKey` would settle, or why it cannot.
 * `escrowId` is the contract that holds the crypto until the payout is known,
 * or null when the payment goes straight to the destination.
 */
export const resolveSettlementRoute = createSettlementRouteResolver<PaymentAsset, Decimal, Asset>({
  // Any existing account accepts XLM.
  fallbackAsset: "XLM",
  isIssuedAsset,
  getDepositAddress: (asset) => rail.getDepositAddress(asset),
  canReceive: (account, asset) => walletService.canReceive(account, asset),
  holdsOtherIssuer: (account, asset) => walletService.holdsOtherIssuer(account, asset),
  findStrictSendPaths: (from, to, amount) => findStrictSendPaths(from, to, amount),
  escrow: {
    appliesTo: escrowAppliesTo,
    contractId: escrowContractId,
    holdsAsset: (asset) => escrowHoldsAsset(asset),
  },
});
