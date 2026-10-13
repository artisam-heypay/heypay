// src/server/payments/own-wallet.ts
//
// Quote-time checks for a payer who pays from their own wallet. HeyPay keeps no
// balance for that account, so what it holds is read from the chain. What is
// wrong with it is said in the wallet's own terms: nothing here offers a fix
// inside the HeyPay wallet, because that wallet is not the one paying.
import "server-only";
import { dec, Decimal } from "@/lib/money";
import { conflict, type AppError } from "@/lib/errors";
import { isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { escrowAppliesTo, escrowFeeEstimateXlm } from "@/server/stellar/escrow-config";
import { isMainnet } from "@/server/stellar/horizon";
import { walletService } from "@/server/stellar/wallet";
import type { RouteRefusal } from "./settlement-route";

/**
 * What a payer is told when their own account cannot pay in `asset` at all: it
 * is not on this network, or it holds no line to the asset.
 */
export function ownWalletCannotHold(asset: PaymentAsset): AppError {
  const network = isMainnet() ? "Mainnet" : "Testnet";
  return conflict(
    isIssuedAsset(asset)
      ? `Your wallet cannot hold ${asset} on ${network} yet. Add ${asset} to it, then try again.`
      : `Your wallet's account does not exist on ${network} yet. Fund it, then try again.`,
    { asset, reason: "own_wallet_cannot_hold" },
  );
}

/**
 * The settlement-route refusals that read differently for a payer's own wallet,
 * or null for the ones that read the same whoever pays. "Turn on USDC" is a
 * button for the HeyPay wallet; their own wallet has to add the asset itself.
 */
export function ownWalletRouteRefused(asset: PaymentAsset, reason: RouteRefusal): AppError | null {
  return reason === "payer_no_trustline" ? ownWalletCannotHold(asset) : null;
}

/**
 * Refuses a quote the payer's own account could not pay: too little of the
 * asset, or too little XLM left over for the network's fees. Their wallet pays
 * those fees itself, as the source of the escrow deposit.
 */
export async function assertOwnWalletFunds(
  account: string,
  asset: PaymentAsset,
  amountAsset: Decimal,
  networkFeeXlm: Decimal,
): Promise<void> {
  const balances = await walletService.getBalances(
    account,
    isIssuedAsset(asset) ? [asset, "XLM"] : ["XLM"],
  );
  const held = (wanted: PaymentAsset) =>
    balances.find((b) => b.asset === wanted)?.balance ?? dec("0");
  // The network keeps a minimum XLM balance in every account and takes no fee
  // out of it. If that cannot be read, nothing counts as locked and the network
  // has the last word when the deposit is built.
  const lockedXlm = await walletService.lockedXlm(account).catch(() => dec("0"));
  const spendableXlm = Decimal.max(held("XLM").minus(lockedXlm), 0);
  const xlmFees = networkFeeXlm.plus(escrowAppliesTo(asset) ? escrowFeeEstimateXlm() : dec("0"));

  const available = isIssuedAsset(asset) ? held(asset) : spendableXlm;
  if (available.lessThan(amountAsset)) {
    throw conflict(
      `Your wallet has ${available.toFixed(7)} ${asset} to spend. ` +
        `This payment needs ${amountAsset.toFixed(7)} ${asset}.`,
      {
        asset,
        reason: "own_wallet_short",
        available: available.toFixed(7),
        required: amountAsset.toFixed(7),
      },
    );
  }
  const xlmLeft = isIssuedAsset(asset) ? spendableXlm : spendableXlm.minus(amountAsset);
  if (xlmLeft.lessThan(xlmFees)) {
    const fee = xlmFees.toDecimalPlaces(2, Decimal.ROUND_UP).toString();
    throw conflict(
      `Your wallet needs about ${fee} XLM for network fees on top of this payment. ` +
        "Add XLM to it, then try again.",
      {
        asset,
        reason: "own_wallet_short_fee",
        availableXlm: xlmLeft.toFixed(7),
        requiredXlm: xlmFees.toFixed(7),
      },
    );
  }
}
