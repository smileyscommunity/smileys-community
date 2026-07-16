-- External ticket-purchase URL for venue-paid events (venue's ticketing
-- page, Eventbrite, …). Nullable so every existing row stays valid; only
-- rendered for venue-paid events — Smileys-collected events use the in-app
-- payment ledger and must not point members elsewhere.

ALTER TABLE "events" ADD COLUMN "ticketUrl" TEXT;
