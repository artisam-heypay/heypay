-- A payer who chose their own wallet signs the escrow deposit themselves.
-- `externalPublicKey` records, on the payment, the account that deposit came
-- from. It stays with the payment whatever the payer later does with their
-- wallet choice, so the settle job knows not to touch a custodial balance for
-- it. Null for every payment the custodial wallet paid.

ALTER TABLE "Payment" ADD COLUMN "externalPublicKey" TEXT;
