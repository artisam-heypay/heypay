-- Testnet faucet: one test-XLM claim per payer.

CREATE TYPE "FaucetClaimStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "FaucetClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountXlm" DECIMAL(20,7) NOT NULL,
    "status" "FaucetClaimStatus" NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaucetClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FaucetClaim_userId_key" ON "FaucetClaim"("userId");
CREATE UNIQUE INDEX "FaucetClaim_txHash_key" ON "FaucetClaim"("txHash");

ALTER TABLE "FaucetClaim" ADD CONSTRAINT "FaucetClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
