-- A stealth RSVP that lands on the waitlist keeps its stealth: the entry
-- carries the flag so the roster and a promotion honour it.
ALTER TABLE "waitlist" ADD COLUMN "stealth" BOOLEAN NOT NULL DEFAULT false;
