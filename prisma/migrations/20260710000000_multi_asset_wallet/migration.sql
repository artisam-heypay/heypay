-- Multi-asset custodial wallet (issues #163 / #164).
--
-- Native XLM keeps living on "CustodialWallet"."cachedXlmBalance"/"reservedXlm".
-- Issued assets (USDC/USDT) get a row per (wallet, asset) in "WalletBalance",
-- which also records whether the account holds a trustline to the issuer.
--
-- Existing amount columns are reused, not renamed: every pre-existing row is XLM,
-- and the Prisma models map `amount`/`amountAsset` onto them.

-- AlterTable: tag every existing wallet ledger entry as XLM.
ALTER TABLE "WalletTransaction" ADD COLUMN "asset" "PaymentAsset" NOT NULL DEFAULT 'XLM';

-- CreateTable
CREATE TABLE "WalletBalance" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "asset" "PaymentAsset" NOT NULL,
    "cached" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "trustlineEstablishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletBalance_walletId_asset_key" ON "WalletBalance"("walletId", "asset");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_asset_createdAt_idx" ON "WalletTransaction"("walletId", "asset", "createdAt");

-- AddForeignKey
ALTER TABLE "WalletBalance" ADD CONSTRAINT "WalletBalance_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CustodialWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
