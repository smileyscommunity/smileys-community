-- Add a sorted-pair key to member_connections so the unordered pair (A,B) has
-- DB-enforced uniqueness. Without this, two concurrent inserts (A->B and B->A)
-- both pass the application-level OR check and both succeed, since the existing
-- unique constraint only covers (requesterId, receiverId).

ALTER TABLE "member_connections" ADD COLUMN "pairKey" TEXT;

UPDATE "member_connections"
SET "pairKey" = LEAST("requesterId", "receiverId") || '|' || GREATEST("requesterId", "receiverId");

-- Best-effort dedupe: if duplicates already exist, keep the oldest row per pair
-- so the unique constraint below doesn't fail on existing data.
DELETE FROM "member_connections" a
USING "member_connections" b
WHERE a."pairKey" = b."pairKey"
  AND a."createdAt" > b."createdAt";

ALTER TABLE "member_connections" ALTER COLUMN "pairKey" SET NOT NULL;
CREATE UNIQUE INDEX "member_connections_pairKey_key" ON "member_connections" ("pairKey");
