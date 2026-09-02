-- Day-before reconfirmation on free, limited-spot events. `reconfirmAskedAt`
-- is the ask's idempotency stamp; `reconfirmedAt` is the member's answer.
-- An asked-but-unanswered seat is released to the waitlist at the
-- cancellation cutoff when someone is waiting (status 'removed',
-- cancelledBy 'system' — never a no-show).
ALTER TABLE "event_attendees" ADD COLUMN "reconfirmAskedAt" TIMESTAMP(3);
ALTER TABLE "event_attendees" ADD COLUMN "reconfirmedAt"    TIMESTAMP(3);
