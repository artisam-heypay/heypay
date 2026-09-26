-- Retire PDAX: settlement now sends the payer's crypto to the HeyPay treasury and
-- pays the merchant in PHP through a Xendit payout.
--
-- Drain in-flight payments before deploying. Any payment still in a PDAX trade
-- state is moved back to STELLAR_CONFIRMED so the Xendit payout step picks it up.
-- The PDAX_TRADING / PDAX_TRADED enum values stay, because PaymentEvent history
-- still references them.

UPDATE "Payment" SET "status" = 'STELLAR_CONFIRMED'
WHERE "status" IN ('PDAX_TRADING', 'PDAX_TRADED');

ALTER TABLE "Payment" RENAME COLUMN "pdaxFeePhp" TO "payoutFeePhp";
ALTER TABLE "Payment" RENAME COLUMN "pdaxCashoutRef" TO "payoutRef";
ALTER TABLE "Payment" DROP COLUMN "pdaxTradeRef";
ALTER TABLE "Payment" ADD COLUMN "refundTxHash" TEXT;
ALTER TABLE "Payment" ADD COLUMN "refundSubmittedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_payoutRef_key" ON "Payment"("payoutRef");
CREATE UNIQUE INDEX "Payment_refundTxHash_key" ON "Payment"("refundTxHash");

ALTER TABLE "Merchant" ADD COLUMN "payoutEmail" TEXT;

ALTER TABLE "ExchangeRateSnapshot" ALTER COLUMN "source" SET DEFAULT 'COINSPH';
