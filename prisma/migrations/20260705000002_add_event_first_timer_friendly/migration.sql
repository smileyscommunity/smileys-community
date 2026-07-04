-- Curated newcomer signal on events. Admins flag low-commitment, welcoming
-- events (coffee meetups, language exchanges) so the "Your First Event"
-- matcher can boost them for members who have never RSVP'd. Defaults false
-- so every existing row stays valid and events opt in via curation.

ALTER TABLE "events" ADD COLUMN "isFirstTimerFriendly" BOOLEAN NOT NULL DEFAULT false;
