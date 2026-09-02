-- Attendee rows now outlive the RSVP. A member's cancel (or a host's
-- removal) used to DELETE the row, which left no trace of whether the spot
-- was handed back in time — the one fact a no-show policy hinges on. From
-- here on the row stays, with status 'cancelled' (member) / 'removed'
-- (host or admin) and the moment it happened. Every read that means "is
-- attending" filters on status; see lib/attendance.ts.
ALTER TABLE "event_attendees" ADD COLUMN "attendance"  TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE "event_attendees" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "event_attendees" ADD COLUMN "cancelledBy" TEXT;

-- Settled outcome for everyone already checked in. Everyone else stays
-- 'unknown': the pre-policy record cannot say whether check-in was run at
-- all, so it must not be read as a no-show.
UPDATE "event_attendees" SET "attendance" = 'attended' WHERE "checkedIn" = true;

-- Per-member reads ("what is this person attending") now carry a status
-- filter on every call; the existing (eventId, status) index covers the
-- per-event side only.
CREATE INDEX "event_attendees_userId_status_idx" ON "event_attendees"("userId", "status");
