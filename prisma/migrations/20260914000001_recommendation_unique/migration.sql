-- One event_recommendations row per (userId, eventId).
--
-- Writers are serialized per member (lib/eventRecommendations advisory lock) and the
-- existing duplicates were pruned in production on 2026-09-14 (0 groups left). The
-- dedupe below repeats the prune's rule so the index can't fail on a straggler: keep
-- the earliest row (createdAt, id), fold the earliest click/RSVP stamp onto it, delete
-- the rest. Index name matches Prisma's default for @@unique([userId, eventId]).

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
