-- Additive only: two nullable columns + an index. No backfill (null = active / not scrubbed).
ALTER TABLE "sponsor_leads" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "scrubbedAt" TIMESTAMP(3);
CREATE INDEX "sponsor_leads_archivedAt_idx" ON "sponsor_leads"("archivedAt");
-- Rollback: DROP INDEX "sponsor_leads_archivedAt_idx"; ALTER TABLE "sponsor_leads" DROP COLUMN "archivedAt", DROP COLUMN "scrubbedAt";
