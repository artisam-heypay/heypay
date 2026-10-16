-- A payment the payer cancels before sending any crypto is CANCELLED, not FAILED,
-- so the admin's failure list and counts show only payments that really failed.
ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';
