-- SponsorLead — B2B pipeline for /advertise inquiries. Submissions used
-- to flow through /api/contact as email only, so there was no record of
-- leads or which ones became paid sponsorships. Admins work the pipeline
-- at /admin/sponsors: new → contacted → negotiating → won | lost.

CREATE TABLE "sponsor_leads" (
    "id"         TEXT             NOT NULL,
    "name"       TEXT             NOT NULL,
    "email"      TEXT             NOT NULL,
    "company"    TEXT             NOT NULL,
    "format"     TEXT             NOT NULL,
    "message"    TEXT             NOT NULL,
    "status"     TEXT             NOT NULL DEFAULT 'new',
    "dealValue"  DOUBLE PRECISION,
    "currency"   TEXT             NOT NULL DEFAULT 'TRY',
    "adminNotes" TEXT,
    "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsor_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sponsor_leads_status_idx" ON "sponsor_leads" ("status");

CREATE INDEX "sponsor_leads_createdAt_idx" ON "sponsor_leads" ("createdAt");
