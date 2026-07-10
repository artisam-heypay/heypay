-- Settlement route for issued assets the rail cannot receive (issue #164, strategy B).
--
-- When PDAX has no deposit wallet for USDC/USDT — or its wallet holds no trustline
-- to the asset — the payer's crypto is converted to XLM on the Stellar DEX during
-- the same payment (path payment) and delivered to PDAX's XLM wallet. These columns
-- record what the rail is expected to receive and sell.
--
-- Both are nullable: an existing row, and any payment the rail takes directly,
-- settles in `asset` itself.

ALTER TABLE "Payment" ADD COLUMN "settlementAsset" "PaymentAsset";
ALTER TABLE "Payment" ADD COLUMN "settlementAmount" DECIMAL(20,7);
