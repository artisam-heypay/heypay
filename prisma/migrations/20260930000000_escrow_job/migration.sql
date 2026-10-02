-- D1: the settle job can hold the payer's crypto in the Soroban escrow contract
-- (ESCROW_ENABLED) instead of paying the treasury directly.

ALTER TABLE "Payment" ADD COLUMN "escrowJobId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "escrowReleaseTxHash" TEXT;

CREATE UNIQUE INDEX "Payment_escrowJobId_key" ON "Payment"("escrowJobId");
CREATE UNIQUE INDEX "Payment_escrowReleaseTxHash_key" ON "Payment"("escrowReleaseTxHash");
