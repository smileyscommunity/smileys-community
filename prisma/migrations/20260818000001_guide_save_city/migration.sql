-- Scope guide saves to a city.
--
-- GuideSave was keyed on (userId, slug) alone, from when Istanbul was the only
-- city. Two cities reusing an experience slug would then share one row, and
-- every count over the table was network-wide — which is how the guide showed
-- "5 completed ✓" under the heading "My Bodrum" for five things done in
-- Istanbul.
--
-- Safe to run in this order: the column arrives nullable, existing rows are
-- matched to the city that owns their slug (default city wins a collision, and
-- anything unmatched falls back to the default city rather than being dropped),
-- then it becomes required and the key is widened.
--
-- Production has zero rows today, so the backfill is a no-op there. It is
-- written properly anyway for any environment that does have some.

ALTER TABLE "guide_saves" ADD COLUMN "cityId" TEXT;

UPDATE "guide_saves" s
SET "cityId" = COALESCE(
  (SELECT g."cityId" FROM "guide_entries" g
    WHERE g.slug = s.slug AND g.kind = 'experience'
    ORDER BY (g."cityId" = (SELECT id FROM cities WHERE slug = 'istanbul')) DESC
    LIMIT 1),
  (SELECT id FROM cities WHERE slug = 'istanbul')
)
WHERE s."cityId" IS NULL;

-- Any row still null means there is no istanbul city row either (a fresh
-- clone); nothing to scope, so drop those rather than block the migration.
DELETE FROM "guide_saves" WHERE "cityId" IS NULL;

ALTER TABLE "guide_saves" ALTER COLUMN "cityId" SET NOT NULL;

DROP INDEX IF EXISTS "guide_saves_userId_slug_key";
CREATE UNIQUE INDEX "guide_saves_userId_cityId_slug_key" ON "guide_saves"("userId", "cityId", "slug");
CREATE INDEX "guide_saves_cityId_slug_idx" ON "guide_saves"("cityId", "slug");

ALTER TABLE "guide_saves"
  ADD CONSTRAINT "guide_saves_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
