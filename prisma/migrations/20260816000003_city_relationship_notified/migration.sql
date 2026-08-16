-- Launch-day notification dedupe: stamp when the "your city is open" email
-- went out for an interest row, so a live → paused → live flip can't email
-- the same members twice.

ALTER TABLE "city_relationships" ADD COLUMN "notifiedAt" TIMESTAMP(3);
