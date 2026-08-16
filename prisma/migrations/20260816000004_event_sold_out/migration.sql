-- A manual sold-out marker for events, independent of the spot counter.
--
-- Safe in either order with the code: the default is false, so every existing
-- event keeps behaving exactly as it does today and the flag only ever does
-- something once someone sets it. PG11+ fills a NOT NULL DEFAULT without
-- rewriting the table, so this is instant on a live events table.

ALTER TABLE "events" ADD COLUMN "soldOut" BOOLEAN NOT NULL DEFAULT false;
