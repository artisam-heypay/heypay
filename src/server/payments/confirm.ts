// src/server/payments/confirm.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { dec, Decimal } from "@/lib/money";
import { isIssuedAsset } from "@/lib/assets";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { getAssetBalance, reserveAsset } from "@/server/wallet/balances";
import { escrowAppliesTo, escrowFeeEstimateXlm } from "@/server/stellar/escrow-config";
import { walletService } from "@/server/stellar/wallet";
import { withIdempotencyKey } from "./idempotency";
import { paymentRefused } from "./refusal";
import { applyTransition } from "./state-machine";
import { enqueueSettle } from "@/server/queue/queues";

export type ConfirmPaymentInput = { paymentId: string; payerId: string; idemKey: string };
export type ConfirmPaymentResult = { paymentId: string; status: PaymentStatus };

export async function confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
  return withIdempotencyKey(input.idemKey, "payment.confirm", async () => {
    const payment = await db.payment.findUnique({
      where: { id: input.paymentId },
      include: { payer: { include: { wallet: true } } },
    });
    if (!payment) throw notFound("payment not found");
    if (payment.payerId !== input.payerId) throw forbidden("not your payment");

    // Already authorised (e.g. a retried request with a fresh key) → return current state.
    if (payment.status === "AUTHORIZED") return { paymentId: payment.id, status: payment.status };
    if (payment.status !== "QUOTED")
      throw conflict(`cannot confirm payment in status ${payment.status}`);
    if (!payment.quoteExpiresAt || payment.quoteExpiresAt.getTime() < Date.now()) {
      throw conflict("quote expired; please re-quote");
    }

    const wallet = payment.payer.wallet;
    if (!wallet) throw conflict("payer wallet not found");

    const asset = payment.asset;
    const amountAsset = dec(payment.amountAsset.toString());
    const networkFeeXlm = dec(payment.networkFeeXlm.toString());
    // For XLM both legs are the same balance, so reserve them as one amount; for
    // an issued asset the fee is a separate XLM hold.
    const assetHold = isIssuedAsset(asset) ? amountAsset : amountAsset.plus(networkFeeXlm);
    // An escrow deposit's Soroban fee must still be there when it runs. It is not
    // reserved (its real size is debited once the deposit lands), only checked,
    // and it is XLM whatever the asset.
    const escrowFee = escrowAppliesTo(asset) ? escrowFeeEstimateXlm() : dec("0");
    // The network keeps a minimum XLM balance in every account and takes no fee
    // out of it. Read before the transaction, which must not wait on Horizon; if
    // the chain cannot be read, nothing counts as locked.
    const lockedXlm = isIssuedAsset(asset)
      ? await walletService.lockedXlm(wallet.stellarPublicKey).catch(() => dec("0"))
      : dec("0");

    const updated = await db.$transaction(async (tx) => {
      const balance = await getAssetBalance(tx, wallet.id, asset);
      const needed = isIssuedAsset(asset) ? assetHold : assetHold.plus(escrowFee);
      // Refused inside the transaction, before anything is held: a throw here
      // leaves no reservation behind.
      if (balance.available.lessThan(needed)) {
        // A wallet that cannot hold the asset at all needs it turned on first.
        const reason =
          isIssuedAsset(asset) && !balance.canReceive
            ? "payer_no_trustline"
            : "insufficient_balance";
        throw paymentRefused(reason, asset, { available: balance.available, required: needed });
      }
      await reserveAsset(tx, wallet.id, asset, assetHold);

      if (isIssuedAsset(asset)) {
        const xlm = await getAssetBalance(tx, wallet.id, "XLM");
        const xlmFees = networkFeeXlm.plus(escrowFee);
        const spendableXlm = Decimal.max(xlm.available.minus(lockedXlm), 0);
        if (spendableXlm.lessThan(xlmFees)) {
          throw paymentRefused("insufficient_fee", asset, {
            availableXlm: spendableXlm,
            requiredXlm: xlmFees,
          });
        }
        await reserveAsset(tx, wallet.id, "XLM", networkFeeXlm);
      }

      return applyTransition(tx, payment, "AUTHORIZED", {
        asset,
        reservedAsset: assetHold.toFixed(7),
        reservedXlmFee: isIssuedAsset(asset) ? networkFeeXlm.toFixed(7) : undefined,
      });
    });

    await enqueueSettle(payment.id);
    return { paymentId: updated.id, status: updated.status };
  });
}
