-- CommunityPoll gains a city.
--
-- It was the only content query on the dashboard with no city scope at all:
-- one active poll, chosen by `findFirst({ where: { active: true } })`, rendered
-- on every city's dashboard. The live question has been up since 2026-05-10 and
-- its 176 votes are Istanbul's, so Tbilisi and Ankara members were being shown
-- an Istanbul question and Istanbul's results as though they were their own.
--
-- NULL means "every city", deliberately: a genuinely global question should be
-- askable once. The existing row is backfilled to the default city, because
-- that is whose members voted in it.
ALTER TABLE "community_polls" ADD COLUMN "cityId" TEXT;

CREATE INDEX "community_polls_cityId_idx" ON "community_polls"("cityId");

ALTER TABLE "community_polls"
  ADD CONSTRAINT "community_polls_cityId_fkey"
  FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every poll that exists today predates multi-city and belongs to
-- the default city. Guarded on NULL so a re-run is a no-op.
UPDATE "community_polls"
   SET "cityId" = (SELECT "id" FROM "cities" WHERE "slug" = 'istanbul')
 WHERE "cityId" IS NULL
   AND EXISTS (SELECT 1 FROM "cities" WHERE "slug" = 'istanbul');
