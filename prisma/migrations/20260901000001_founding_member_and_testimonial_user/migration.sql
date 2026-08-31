-- Founding members: a stored historical fact (approved while the city was
-- seeding), set at approval time from here on. The backfill below grants it
-- to the current members of the cities that are in the seeding stage at the
-- time this migration ships (Izmir, Bodrum, Antalya — each well under the
-- 20-member forming threshold). Istanbul predates the concept and is
-- deliberately excluded.
ALTER TABLE "users" ADD COLUMN "foundingMember" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "foundingMember" = true
WHERE status = 'approved'
  AND role NOT IN ('admin', 'partner')
  AND "cityId" IN (SELECT id FROM "cities" WHERE slug IN ('izmir', 'bodrum', 'antalya'));

-- Member-submitted testimonials: who said it, so the dashboard nudge can
-- dedupe ("asked and answered") and a member's quote is cleaned up on
-- account deletion. Admin-authored quotes keep this NULL.
ALTER TABLE "testimonials" ADD COLUMN "userId" TEXT;

ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "testimonials_userId_idx" ON "testimonials"("userId");
