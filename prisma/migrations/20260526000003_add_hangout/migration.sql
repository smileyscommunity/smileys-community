-- Spontaneous "I'm at X right now" hangouts. Auto-expire via the cron when
-- endsAt is past. Member-host only; no RSVP, no quota.

CREATE TABLE "hangouts" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "location"     TEXT NOT NULL,
  "neighborhood" TEXT,
  "startsAt"     TIMESTAMP(3) NOT NULL,
  "endsAt"       TIMESTAMP(3) NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'active',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hangouts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "hangouts"
  ADD CONSTRAINT "hangouts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "hangouts_status_endsAt_idx"       ON "hangouts" ("status", "endsAt");
CREATE INDEX "hangouts_neighborhood_status_idx" ON "hangouts" ("neighborhood", "status");
