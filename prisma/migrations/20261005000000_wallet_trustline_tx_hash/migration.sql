-- The changeTrust transaction that gave the wallet its trustline, kept so the
-- payer can open it on a block explorer. Null for a line that already existed
-- on-chain when HeyPay first saw it.

ALTER TABLE "WalletBalance" ADD COLUMN "trustlineTxHash" TEXT;
