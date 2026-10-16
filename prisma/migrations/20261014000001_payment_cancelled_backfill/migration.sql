-- Payments cancelled before CANCELLED existed were recorded as FAILED with this
-- reason. Move them, and the event that recorded the move, to CANCELLED. This is
-- its own migration because Postgres cannot use an enum value in the same
-- transaction that added it.
UPDATE "PaymentEvent" e
SET "toStatus" = 'CANCELLED'
FROM "Payment" p
WHERE e."paymentId" = p."id"
  AND p."status" = 'FAILED'
  AND p."failureReason" = 'cancelled by payer'
  AND e."toStatus" = 'FAILED';

UPDATE "Payment"
SET "status" = 'CANCELLED'
WHERE "status" = 'FAILED'
  AND "failureReason" = 'cancelled by payer';
