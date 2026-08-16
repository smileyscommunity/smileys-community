-- Rollback for 20260816000001_merge_city_relationships: restore the two
-- original tables from the merged rows. Lossless — "type" partitions the
-- merged table exactly back into its sources (the only rows not restored
-- are interest rows that were superseded by a membership during the merge,
-- which is the correct end state anyway).
--
-- Run manually, then deploy the pre-merge code, then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260816000001_merge_city_relationships';

CREATE TABLE "city_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "city_memberships_userId_cityId_key" ON "city_memberships"("userId", "cityId");
CREATE INDEX "city_memberships_cityId_idx" ON "city_memberships"("cityId");

ALTER TABLE "city_memberships" ADD CONSTRAINT "city_memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "city_memberships" ADD CONSTRAINT "city_memberships_cityId_fkey"
    FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "city_interests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_interests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "city_interests_userId_cityId_key" ON "city_interests"("userId", "cityId");
CREATE INDEX "city_interests_cityId_idx" ON "city_interests"("cityId");

ALTER TABLE "city_interests" ADD CONSTRAINT "city_interests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "city_interests" ADD CONSTRAINT "city_interests_cityId_fkey"
    FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "city_memberships" ("id", "userId", "cityId", "joinedAt")
SELECT "id", "userId", "cityId", "createdAt" FROM "city_relationships" WHERE "type" = 'member';

INSERT INTO "city_interests" ("id", "userId", "cityId", "createdAt")
SELECT "id", "userId", "cityId", "createdAt" FROM "city_relationships" WHERE "type" = 'interested';

DROP TABLE "city_relationships";
