-- Per-city audit trail. Nullable: platform-wide actions have no city, and
-- rows written before this column existed are left null rather than guessed
-- at. writeAudit resolves it from the target from here on.
ALTER TABLE "audit_logs" ADD COLUMN "cityId" TEXT;
CREATE INDEX "audit_logs_cityId_createdAt_idx" ON "audit_logs"("cityId", "createdAt");
