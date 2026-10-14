-- Additive only: one new table + indexes. No backfill.
CREATE TABLE "partnerships" (
  "id" TEXT NOT NULL,
  "organizer" TEXT NOT NULL,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "website" TEXT,
  "stage" TEXT NOT NULL DEFAULT 'research',
  "type" TEXT,
  "leadId" TEXT,
  "eventId" TEXT,
  "postId" TEXT,
  "campaignName" TEXT,
  "deliverables" TEXT,
  "startDate" TEXT,
  "endDate" TEXT,
  "feeAmount" DOUBLE PRECISION,
  "feeCurrency" TEXT NOT NULL DEFAULT 'TRY',
  "commissionType" TEXT,
  "commissionRate" DOUBLE PRECISION,
  "commissionCurrency" TEXT,
  "commissionBasis" TEXT,
  "reportingTerms" TEXT,
  "paymentTerms" TEXT,
  "paymentStatus" TEXT NOT NULL DEFAULT 'none',
  "followUpDate" TEXT,
  "internalNotes" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partnerships_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "partnerships_stage_idx" ON "partnerships"("stage");
CREATE INDEX "partnerships_followUpDate_idx" ON "partnerships"("followUpDate");
CREATE INDEX "partnerships_archivedAt_idx" ON "partnerships"("archivedAt");
-- Rollback: DROP TABLE "partnerships";
