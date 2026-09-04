-- Handbook articles come in three scopes, and until now the schema could only
-- express two. `cityId` null meant "show in every city", which was harmless
-- while every city was Turkish: residence permits, Turkish bank accounts, SIM
-- cards and the Türkiye scam guide are NATIONAL, and every city was in
-- Türkiye. The first non-Turkish city makes all four wrong at once, telling a
-- member in Athens or New York how to get a Turkish residence permit.
--
-- `country` names the country a non-city-local post applies in:
--   cityId set                → that city only
--   cityId null, country 'TR' → every Turkish city
--   cityId null, country null → genuinely global
ALTER TABLE "posts" ADD COLUMN "country" TEXT;

-- Backfill: every currently-global HANDBOOK article is Türkiye-specific (three
-- say so in their own slug). Community posts stay global — country null.
-- Guarded on country IS NULL so a re-run is a no-op.
UPDATE "posts"
   SET "country" = 'TR'
 WHERE "kind" = 'handbook' AND "cityId" IS NULL AND "country" IS NULL;

CREATE INDEX "posts_cityId_country_idx" ON "posts"("cityId", "country");
