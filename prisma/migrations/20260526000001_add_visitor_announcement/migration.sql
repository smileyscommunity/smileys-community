-- "I'm visiting Istanbul" announcements. Anonymous-friendly so visitors who
-- haven't joined yet can post — that's the whole growth lever.

CREATE TABLE "visitor_announcements" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT,
  "name"         TEXT NOT NULL,
  "email"        TEXT,
  "fromCity"     TEXT,
  "intro"        TEXT NOT NULL,
  "startsOn"     TEXT NOT NULL,
  "endsOn"       TEXT NOT NULL,
  "neighborhood" TEXT,
  "contact"      TEXT,
  "status"       TEXT NOT NULL DEFAULT 'active',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "visitor_announcements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "visitor_announcements"
  ADD CONSTRAINT "visitor_announcements_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "visitor_announcements_status_endsOn_idx"       ON "visitor_announcements" ("status", "endsOn");
CREATE INDEX "visitor_announcements_neighborhood_status_idx" ON "visitor_announcements" ("neighborhood", "status");
