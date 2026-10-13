-- Additive only: nullable columns + one new table. No backfill needed.
ALTER TABLE "sponsor_leads" ADD COLUMN "source" TEXT, ADD COLUMN "eventName" TEXT, ADD COLUMN "eventDate" TEXT, ADD COLUMN "eventWebsite" TEXT;
ALTER TABLE "posts" ADD COLUMN "eventDetails" JSONB;
CREATE TABLE "post_member_offers" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "url" TEXT,
  "code" TEXT,
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "post_member_offers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "post_member_offers_postId_key" ON "post_member_offers"("postId");
ALTER TABLE "post_member_offers" ADD CONSTRAINT "post_member_offers_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Rollback: DROP TABLE "post_member_offers"; ALTER TABLE "posts" DROP COLUMN "eventDetails"; ALTER TABLE "sponsor_leads" DROP COLUMN "source", DROP COLUMN "eventName", DROP COLUMN "eventDate", DROP COLUMN "eventWebsite";
