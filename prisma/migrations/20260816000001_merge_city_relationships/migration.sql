-- Merge city_memberships + city_interests into one city_relationships table.
--
-- 'member'     — city joined beyond home (home stays on users."cityId")
-- 'interested' — pre-launch waiting list
--
-- Unique on ("userId","cityId") WITHOUT type: member-and-interested in the
-- same city is a contradiction; members win the merge below.
--
-- PRODUCTION SEQUENCE (run manually by the owner, after pg_dump):
--   1. Run this migration.
--   2. Deploy the code that reads city_relationships.
--   Rollback: rollback.sql in this directory restores both tables from the
--   merged rows (lossless — "type" partitions them).

CREATE TABLE "city_relationships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_relationships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "city_relationships_userId_cityId_key" ON "city_relationships"("userId", "cityId");
CREATE INDEX "city_relationships_cityId_type_idx" ON "city_relationships"("cityId", "type");

ALTER TABLE "city_relationships" ADD CONSTRAINT "city_relationships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "city_relationships" ADD CONSTRAINT "city_relationships_cityId_fkey"
    FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy memberships first (joinedAt becomes createdAt)…
INSERT INTO "city_relationships" ("id", "userId", "cityId", "type", "createdAt")
SELECT "id", "userId", "cityId", 'member', "joinedAt"
FROM "city_memberships";

-- …then interest rows; a user who registered interest and later joined the
-- same city keeps the member row (ON CONFLICT DO NOTHING).
INSERT INTO "city_relationships" ("id", "userId", "cityId", "type", "createdAt")
SELECT "id", "userId", "cityId", 'interested', "createdAt"
FROM "city_interests"
ON CONFLICT ("userId", "cityId") DO NOTHING;

DROP TABLE "city_memberships";
DROP TABLE "city_interests";
