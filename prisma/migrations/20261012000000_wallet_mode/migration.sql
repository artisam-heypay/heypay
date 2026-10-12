-- A payer can opt in to signing escrow deposits with their own wallet instead
-- of the custodial one. `walletMode` is that choice and `externalPublicKey` the
-- account their wallet reported when they connected it. Everyone starts, and
-- stays unless they opt in, on the custodial wallet.

CREATE TYPE "WalletMode" AS ENUM ('CUSTODIAL', 'EXTERNAL');

ALTER TABLE "User" ADD COLUMN "walletMode" "WalletMode" NOT NULL DEFAULT 'CUSTODIAL';
ALTER TABLE "User" ADD COLUMN "externalPublicKey" TEXT;
