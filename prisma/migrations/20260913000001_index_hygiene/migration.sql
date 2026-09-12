-- Index hygiene (scan 4, item 32, 2026-09-13).
--
-- Adds indexes for lookups that had none: event photos by event/user (public
-- event page, recap), blocks by blocked member (the OR on every member list),
-- audit rows by target, reviews by event, reset/verification tokens by user
-- (deleteMany on every resend), listings by expiry (reminders cron), events by
-- series, applications by referrer.
--
-- Drops only indexes that are both redundant (a prefix of a unique, or never
-- queried) AND at zero or near-zero scans in pg_stat_user_indexes on prod
-- (read 2026-09-13; stats never reset). The audit also flagged the single-
-- column EventAttendee/Notification/Event/Payment/User indexes as redundant,
-- but the planner uses them millions of times — those stay.

-- DropIndex
DROP INDEX "users_membershipType_idx";

-- DropIndex
DROP INDEX "users_nationality_idx";

-- DropIndex
DROP INDEX "member_blocks_blockerId_idx";

-- DropIndex
DROP INDEX "city_hosts_userId_idx";

-- DropIndex
DROP INDEX "event_cohosts_eventId_idx";

-- DropIndex
DROP INDEX "notifications_isRead_idx";

-- DropIndex
DROP INDEX "audit_logs_adminId_idx";

-- DropIndex
DROP INDEX "email_failures_helper_idx";

-- DropIndex
DROP INDEX "posts_kind_status_lastReviewedAt_idx";

-- DropIndex
DROP INDEX "posts_cityId_idx";

-- DropIndex
DROP INDEX "direct_message_reactions_messageId_idx";

-- DropIndex
DROP INDEX "hangout_joins_hangoutId_idx";

-- DropIndex
DROP INDEX "business_claims_businessId_idx";

-- CreateIndex
CREATE INDEX "member_blocks_blockedId_idx" ON "member_blocks"("blockedId");

-- CreateIndex
CREATE INDEX "events_seriesId_idx" ON "events"("seriesId");

-- CreateIndex
CREATE INDEX "event_photos_eventId_idx" ON "event_photos"("eventId");

-- CreateIndex
CREATE INDEX "event_photos_userId_idx" ON "event_photos"("userId");

-- CreateIndex
CREATE INDEX "reviews_eventId_idx" ON "reviews"("eventId");

-- CreateIndex
CREATE INDEX "member_applications_referredBy_idx" ON "member_applications"("referredBy");

-- CreateIndex
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_targetId_createdAt_idx" ON "audit_logs"("targetId", "createdAt");

-- CreateIndex
CREATE INDEX "listings_expiresAt_idx" ON "listings"("expiresAt");

