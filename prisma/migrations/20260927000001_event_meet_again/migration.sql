-- "Would you meet them again?" — private post-event picks.
--
-- One row per pick. A pick is never shown to anyone; only a mutual pair is
-- acted on, by turning it into an accepted member_connections row. New table
-- only — nothing existing changes, so no backfill.
CREATE TABLE "event_meet_again" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "pickerId" TEXT NOT NULL,
    "pickedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_meet_again_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "event_meet_again_eventId_pickerId_pickedId_key" ON "event_meet_again"("eventId", "pickerId", "pickedId");
CREATE INDEX "event_meet_again_eventId_pickedId_idx" ON "event_meet_again"("eventId", "pickedId");
CREATE INDEX "event_meet_again_pickedId_idx" ON "event_meet_again"("pickedId");

ALTER TABLE "event_meet_again" ADD CONSTRAINT "event_meet_again_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_meet_again" ADD CONSTRAINT "event_meet_again_pickerId_fkey" FOREIGN KEY ("pickerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_meet_again" ADD CONSTRAINT "event_meet_again_pickedId_fkey" FOREIGN KEY ("pickedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
