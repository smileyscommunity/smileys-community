-- Pro waitlist — early signal for the paid Smileys Pro tier
-- (professional vertical: industry/role filters, intro requests,
-- priority access to pro events). Built before payment integration
-- so we can validate demand and build a founding-member cohort.

CREATE TABLE "pro_waitlist" (
    "id"         TEXT             NOT NULL,
    "userId"     TEXT,
    "name"       TEXT             NOT NULL,
    "email"      TEXT             NOT NULL,
    "industry"   TEXT,
    "role"       TEXT,
    "status"     TEXT             NOT NULL DEFAULT 'waitlisted',
    "adminNotes" TEXT,
    "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pro_waitlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pro_waitlist_email_key" ON "pro_waitlist" ("email");

CREATE INDEX "pro_waitlist_status_idx" ON "pro_waitlist" ("status");

CREATE INDEX "pro_waitlist_createdAt_idx" ON "pro_waitlist" ("createdAt");
