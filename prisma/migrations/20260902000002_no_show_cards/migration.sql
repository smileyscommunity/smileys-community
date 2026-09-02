-- No-show cards. The attendee row's `attendance` column is the attendance
-- record (set to 'no_show' by sweep-no-shows); a card is the consequence and
-- its paper trail — colour, appeal, host waiver, admin resolution, and for a
-- red card the appeal window and the RSVP block that follows it. One card per
-- attendee row (the unique below is the job's idempotency). Cascades follow
-- the member and the event: a deleted account or event takes its cards.
--
-- events.noShowProcessedAt is the per-event stamp: settled once, never again.
-- AlterTable
ALTER TABLE "events" ADD COLUMN     "noShowProcessedAt" TIMESTAMP(3);

-- The policy starts the day it ships. Every event dated before today is
-- stamped as settled so the first hourly run cannot hand out cards for
-- evenings that predate the rules (the lookback window alone would reach a
-- week back). Events dated today are left open and settle tonight as usual.
UPDATE "events" SET "noShowProcessedAt" = CURRENT_TIMESTAMP
WHERE "noShowProcessedAt" IS NULL AND date < to_char(CURRENT_DATE, 'YYYY-MM-DD');
-- CreateTable
CREATE TABLE "no_show_cards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "attendeeId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "appealDeadlineAt" TIMESTAMP(3),
    "restrictionStartsAt" TIMESTAMP(3),
    "restrictionEndsAt" TIMESTAMP(3),
    "restrictionNotifiedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedEventId" TEXT,
    "appealNote" TEXT,
    "appealedAt" TIMESTAMP(3),
    "appealStatus" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedById" TEXT,
    "waiveReason" TEXT,
    CONSTRAINT "no_show_cards_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "no_show_cards_attendeeId_key" ON "no_show_cards"("attendeeId");
-- CreateIndex
CREATE INDEX "no_show_cards_userId_status_idx" ON "no_show_cards"("userId", "status");
-- CreateIndex
CREATE INDEX "no_show_cards_eventId_idx" ON "no_show_cards"("eventId");
-- CreateIndex
CREATE INDEX "no_show_cards_status_restrictionStartsAt_idx" ON "no_show_cards"("status", "restrictionStartsAt");
-- AddForeignKey
ALTER TABLE "no_show_cards" ADD CONSTRAINT "no_show_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "no_show_cards" ADD CONSTRAINT "no_show_cards_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "event_attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "no_show_cards" ADD CONSTRAINT "no_show_cards_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
