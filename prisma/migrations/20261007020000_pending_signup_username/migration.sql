-- Email sign-up asks for a username, kept with the waiting sign-up until its
-- code is confirmed.
--
-- A waiting sign-up lives for minutes and has no username to keep, so the ones
-- in progress are dropped rather than given a made-up name. Whoever was in the
-- middle of one starts again.

DELETE FROM "PendingSignup";
ALTER TABLE "PendingSignup" ADD COLUMN "username" TEXT NOT NULL;
