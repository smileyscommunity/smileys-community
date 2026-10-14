-- Additive only: two nullable columns + one new table. No backfill.
ALTER TABLE "sponsor_leads" ADD COLUMN "campaignSource" TEXT;
ALTER TABLE "partnerships" ADD COLUMN "sourceTag" TEXT;
CREATE TABLE "campaign_report_entries" (
  "id" TEXT NOT NULL,
  "partnershipId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "quantity" INTEGER,
  "amount" DOUBLE PRECISION,
  "currency" TEXT,
  "source" TEXT NOT NULL,
  "reportedAt" TEXT NOT NULL,
  "periodStart" TEXT,
  "periodEnd" TEXT,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "campaign_report_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "campaign_report_entries_partnershipId_kind_idx" ON "campaign_report_entries"("partnershipId", "kind");
-- Rollback: DROP TABLE "campaign_report_entries"; ALTER TABLE "partnerships" DROP COLUMN "sourceTag"; ALTER TABLE "sponsor_leads" DROP COLUMN "campaignSource";
