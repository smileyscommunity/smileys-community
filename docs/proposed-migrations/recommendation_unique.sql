-- PROPOSED — NOT APPLIED. One event_recommendations row per (userId, eventId).
--
-- Deliberately NOT in prisma/migrations yet: deploy.sh refuses to deploy while
-- a migration directory there is unapplied, and the code must not depend on
-- the index (it doesn't — lib/eventRecommendations serializes writers with an
-- advisory lock).
--
-- Apply order (each step only after the previous one is done):
--   1. Deploy the code that ships lib/eventRecommendations.ts, the
--      sweep-recommendation-dupes cron and scripts/prune-duplicate-recommendations.ts.
--      From then on no new duplicates are written and stamps land on the keeper.
--   2. Prune on the server:
--        npx tsx --env-file=.env --env-file=.env.local scripts/prune-duplicate-recommendations.ts          (dry run)
--        APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/prune-duplicate-recommendations.ts
--      (or let the nightly cron finish) until "duplicate groups: 0".
--   3. Locally, in ONE commit:
--        - copy this file to prisma/migrations/<YYYYMMDDHHMMSS>_recommendation_unique/migration.sql
--        - add  @@unique([userId, eventId])  to model EventRecommendation in prisma/schema.prisma
--          (Prisma names that index "event_recommendations_userId_eventId_key" — the
--          name below must match or the next `db push` drops and recreates it)
--   4. Copy the migration directory to /root/smileys-community/prisma/migrations/ on the
--      server and run `npx --no-install prisma migrate deploy` there.
--   5. Then deploy (the pending-migrations gate passes; deploy.sh's `db push` sees the
--      index in schema.prisma and leaves it). Never deploy step 3's schema before step 4:
--      db push would try to create the index itself (and fail on any duplicate); and
--      never apply step 4 without the @@unique in the deployed schema: db push would drop it.
--
-- The dedupe below repeats the prune's rule so the index can't fail on a
-- duplicate written between step 2 and step 4: keep the earliest row
-- (createdAt, id), copy the earliest click/RSVP stamp any duplicate carries
-- onto it when it has none, then delete the rest.

WITH ranked AS (
  SELECT id, "userId", "eventId", "clickedAt", "rsvpedAt",
         first_value(id) OVER w AS keeper,
         row_number()    OVER w AS rn
  FROM "event_recommendations"
  WINDOW w AS (PARTITION BY "userId", "eventId" ORDER BY "createdAt", id)
), folded AS (
  SELECT keeper, MIN("clickedAt") AS "clickedAt", MIN("rsvpedAt") AS "rsvpedAt"
  FROM ranked
  WHERE rn > 1
  GROUP BY keeper
)
UPDATE "event_recommendations" k
SET "clickedAt" = COALESCE(k."clickedAt", f."clickedAt"),
    "rsvpedAt"  = COALESCE(k."rsvpedAt",  f."rsvpedAt")
FROM folded f
WHERE k.id = f.keeper
  AND ((k."clickedAt" IS NULL AND f."clickedAt" IS NOT NULL)
    OR (k."rsvpedAt"  IS NULL AND f."rsvpedAt"  IS NOT NULL));

DELETE FROM "event_recommendations" r
USING "event_recommendations" k
WHERE k."userId" = r."userId"
  AND k."eventId" = r."eventId"
  AND (k."createdAt", k.id) < (r."createdAt", r.id)
  -- a loser's stamp is only dropped once the keeper holds one
  AND (r."clickedAt" IS NULL OR k."clickedAt" IS NOT NULL)
  AND (r."rsvpedAt"  IS NULL OR k."rsvpedAt"  IS NOT NULL);

CREATE UNIQUE INDEX "event_recommendations_userId_eventId_key" ON "event_recommendations"("userId", "eventId");
