-- A swap that was sent and that Horizon could not then confirm or rule out.
-- The row keeps what is on hold for it, so the reconcile job can look the hash
-- up again and record the swap or free the holds.
CREATE TABLE "UnconfirmedSwap" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "fromAsset" "PaymentAsset" NOT NULL,
    "toAsset" "PaymentAsset" NOT NULL,
    "heldAmount" DECIMAL(20,7) NOT NULL,
    "heldFeeXlm" DECIMAL(20,7) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "UnconfirmedSwap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UnconfirmedSwap_txHash_key" ON "UnconfirmedSwap"("txHash");
CREATE INDEX "UnconfirmedSwap_resolvedAt_idx" ON "UnconfirmedSwap"("resolvedAt");

ALTER TABLE "UnconfirmedSwap" ADD CONSTRAINT "UnconfirmedSwap_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CustodialWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
