-- Testimonials get a city. NULL means "across Smileys" — the same convention
-- Club.cityId uses — and a set city means the quote belongs to that place.
--
-- ORDERING MATTERS, and differently from the club change. There, NULL was a
-- state no row was in yet, so the reading code could ship first and wait. Here
-- adding the column puts EVERY existing row into the NULL state at once, and
-- the reading code treats NULL as "show in every city" — so a bare `prisma db
-- push` would put Istanbul's quotes back on Izmir's and Bodrum's pages, which
-- is the exact bug this column exists to fix.
--
-- So the backfill is in the same transaction as the DDL, not a follow-up
-- script: no instant exists where the column is present and unassigned. Run
-- this against the server BEFORE deploying the code (db push then sees a
-- matching column and no-ops).

BEGIN;

ALTER TABLE "testimonials" ADD COLUMN "cityId" TEXT;

-- Every quote on record today was collected in Istanbul. Naming that is the
-- whole point — an unassigned row would silently mean "from everywhere".
UPDATE "testimonials"
SET "cityId" = (SELECT id FROM "cities" WHERE slug = 'istanbul')
WHERE "cityId" IS NULL;

ALTER TABLE "testimonials"
  ADD CONSTRAINT "testimonials_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ON DELETE SET NULL, not CASCADE: deleting a city must not delete a member's
-- words. The quote survives as an across-Smileys one and can be reassigned.

CREATE INDEX "testimonials_cityId_active_order_idx" ON "testimonials"("cityId", "active", "order");

COMMIT;
