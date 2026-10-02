-- Set just before a payout request is sent to the rail. From then on the rail may
-- hold a payout for the payment, so a refund (the payer's own escrow refund, or
-- an admin's) is only allowed once the rail confirms that payout will not be paid.

ALTER TABLE "Payment" ADD COLUMN "payoutRequestedAt" TIMESTAMP(3);
