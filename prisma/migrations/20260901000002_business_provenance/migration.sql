-- Directory provenance & freshness. A venue row promises "this place exists,
-- here, and is open"; these columns record where that promise came from and
-- when it was last checked.
--
-- placeId is Google's Place ID — the field their terms let us retain
-- indefinitely, so it is the durable key for re-fetching the volatile fields
-- (name, address, hours, open/closed) rather than caching those forever.
ALTER TABLE "businesses" ADD COLUMN "placeId"    TEXT;
ALTER TABLE "businesses" ADD COLUMN "source"     TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "businesses" ADD COLUMN "verifiedAt" TIMESTAMP(3);
ALTER TABLE "businesses" ADD COLUMN "closedAt"   TIMESTAMP(3);

-- Existing rows: anything a member submitted is 'member'; everything else was
-- entered by staff, which is what the 'manual' default already says. No row
-- gets a verifiedAt — none of them have been checked against Places, and
-- backdating that would defeat the column's only purpose.
UPDATE "businesses" SET "source" = 'member' WHERE "submittedById" IS NOT NULL;

-- Unique so a re-seed upserts on place id instead of duplicating a venue.
-- Postgres allows many NULLs under a unique index, so rows never matched to
-- Places are unaffected.
CREATE UNIQUE INDEX "businesses_placeId_key" ON "businesses"("placeId");

-- The re-verification sweep reads stalest-live-first, scoped to one city.
CREATE INDEX "businesses_cityId_verifiedAt_idx" ON "businesses"("cityId", "verifiedAt");
