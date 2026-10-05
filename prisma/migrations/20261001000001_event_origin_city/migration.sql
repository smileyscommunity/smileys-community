-- Cross-city trips: an event can depart from another city than the one it
-- visits. Additive and nullable — every existing event stays an ordinary one.
ALTER TABLE "events" ADD COLUMN "originCityId" TEXT;

CREATE INDEX "events_originCityId_idx" ON "events"("originCityId");

ALTER TABLE "events" ADD CONSTRAINT "events_originCityId_fkey"
  FOREIGN KEY ("originCityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
