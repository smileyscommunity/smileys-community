-- Let users flag a listing. Reuses the existing Report model with a new
-- listingId pointer; reportedId is the listing owner (so the existing
-- "reports received per user" counters still work without changes).

ALTER TABLE "reports" ADD COLUMN "listingId" TEXT;
CREATE INDEX "reports_listingId_idx" ON "reports" ("listingId");
