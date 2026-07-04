-- Attribution log for the "Your First Event" matcher. One row per event
-- shown to a member; clickedAt / rsvpedAt are stamped as the member acts,
-- so we can measure recommendation → RSVP lift against the signed-in→RSVP
-- baseline (45.1% as of July 2026). reason holds the score breakdown.

CREATE TABLE "event_recommendations" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "eventId"   TEXT NOT NULL,
    "score"     DOUBLE PRECISION NOT NULL,
    "reason"    JSONB NOT NULL,
    "surface"   TEXT NOT NULL DEFAULT 'first_event_block',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clickedAt" TIMESTAMP(3),
    "rsvpedAt"  TIMESTAMP(3),
    CONSTRAINT "event_recommendations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_recommendations_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "event_recommendations_eventId_fkey" FOREIGN KEY ("eventId")
        REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "event_recommendations_userId_createdAt_idx" ON "event_recommendations"("userId", "createdAt");
CREATE INDEX "event_recommendations_eventId_idx" ON "event_recommendations"("eventId");
