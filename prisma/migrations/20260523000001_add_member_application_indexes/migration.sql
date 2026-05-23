-- Add indexes for hot lookups on member_applications
-- These columns are queried on every /api/apply submission (see app/api/apply/route.ts).
-- Without these indexes, each query is a full table scan.

CREATE INDEX "member_applications_email_idx"       ON "member_applications" ("email");
CREATE INDEX "member_applications_phone_idx"       ON "member_applications" ("phone");
CREATE INDEX "member_applications_instagram_idx"   ON "member_applications" ("instagram");
CREATE INDEX "member_applications_status_idx"      ON "member_applications" ("status");
CREATE INDEX "member_applications_fingerprint_createdAt_idx" ON "member_applications" ("fingerprint", "createdAt");
CREATE INDEX "member_applications_ipAddress_createdAt_idx"   ON "member_applications" ("ipAddress", "createdAt");
