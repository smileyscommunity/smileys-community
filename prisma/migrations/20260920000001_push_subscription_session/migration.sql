-- Signing a device out in /settings should also stop its push notifications.
ALTER TABLE "push_subscriptions" ADD COLUMN "sessionId" TEXT;
CREATE INDEX "push_subscriptions_sessionId_idx" ON "push_subscriptions"("sessionId");
