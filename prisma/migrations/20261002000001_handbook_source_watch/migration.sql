-- Handbook source watch: last-seen state of each official source page.
-- New table only — nothing existing changes.
CREATE TABLE "handbook_sources" (
    "url" TEXT NOT NULL,
    "contentHash" TEXT,
    "text" TEXT,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "checkedAt" TIMESTAMP(3),
    "changedAt" TIMESTAMP(3),
    "lastDiff" TEXT,

    CONSTRAINT "handbook_sources_pkey" PRIMARY KEY ("url")
);

CREATE INDEX "handbook_sources_changedAt_idx" ON "handbook_sources"("changedAt");
