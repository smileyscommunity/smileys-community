-- Additive only: two nullable columns. No backfill (null = not supplied).
ALTER TABLE "sponsor_leads" ADD COLUMN "eventVenue" TEXT, ADD COLUMN "budgetRange" TEXT;
-- Rollback: ALTER TABLE "sponsor_leads" DROP COLUMN "eventVenue", DROP COLUMN "budgetRange";
