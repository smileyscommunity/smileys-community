-- Add spotlight fields to clubs
ALTER TABLE "clubs" ADD COLUMN "spotlightUserId" TEXT;
ALTER TABLE "clubs" ADD COLUMN "spotlightNote" TEXT;
ALTER TABLE "clubs" ADD COLUMN "spotlightUpdatedAt" TIMESTAMP(3);

-- Add foreign key for spotlight
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_spotlightUserId_fkey"
  FOREIGN KEY ("spotlightUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add type field to club_posts
ALTER TABLE "club_posts" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'post';

-- Add clubPhotos relation to users (no column needed, handled by ClubPhoto.userId)
-- Add clubSpotlights relation to users (no column needed, handled by clubs.spotlightUserId)

-- Create club_resources table
CREATE TABLE "club_resources" (
  "id"        TEXT NOT NULL,
  "clubId"    TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "emoji"     TEXT NOT NULL DEFAULT '🔗',
  "order"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "club_resources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "club_resources_clubId_order_idx" ON "club_resources"("clubId", "order");

ALTER TABLE "club_resources" ADD CONSTRAINT "club_resources_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create club_photos table
CREATE TABLE "club_photos" (
  "id"        TEXT NOT NULL,
  "clubId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "caption"   TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "club_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "club_photos_clubId_createdAt_idx" ON "club_photos"("clubId", "createdAt" DESC);

ALTER TABLE "club_photos" ADD CONSTRAINT "club_photos_clubId_fkey"
  FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "club_photos" ADD CONSTRAINT "club_photos_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
