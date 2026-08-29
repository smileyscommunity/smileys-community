-- Link survey-sourced reports to their event_surveys row so that
-- dismissing the report can clear the survey's anomaly flag in the same
-- transaction. Without the link, dismissed survey reports left
-- anomaly=true behind and the admin dashboard kept counting them in the
-- 30-day anomaly rate after the admin had already judged them not real.
--
-- Nullable, no backfill: legacy survey reports fall back at dismiss time
-- to the survey's (eventId, userId) unique key — the reporter is the
-- survey responder.
ALTER TABLE "reports" ADD COLUMN "surveyId" TEXT;

CREATE INDEX "reports_surveyId_idx" ON "reports"("surveyId");

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_surveyId_fkey"
  FOREIGN KEY ("surveyId") REFERENCES "event_surveys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
