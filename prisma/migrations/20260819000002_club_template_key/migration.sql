-- Template provenance for clubs.
--
-- seedCityClubs stamps every starter club out of lib/clubTemplates, but the
-- created row kept no link back to its template. Cheap to record now, painful
-- to reconstruct at ten cities — the moment templates need to evolve
-- ("update every club seeded from 'foodies'", "which cities customised the
-- lineup?"), the mapping has to exist on the row.
--
-- Backfill by construction: seeded slugs are exactly '<key>-<citySlug>'. The
-- key list is a snapshot of lib/clubTemplates.ts at migration time — clubs
-- whose slug doesn't match stay NULL, which is the honest value: hand-made,
-- renamed, or otherwise unprovable.
ALTER TABLE "clubs" ADD COLUMN "templateKey" TEXT;

UPDATE "clubs" c
SET "templateKey" = t.key
FROM "cities" ci,
     unnest(ARRAY[
       'social','language-exchange','foodies','hiking','flow','book-club',
       'coffee-social','shutterbugs','football','board-games','live-music',
       'run-club','newcomers'
     ]) AS t(key)
WHERE c."cityId" = ci.id
  AND c.slug = t.key || '-' || ci.slug
  AND c."templateKey" IS NULL;
