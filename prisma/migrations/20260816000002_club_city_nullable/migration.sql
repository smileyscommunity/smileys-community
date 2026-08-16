-- Club.cityId becomes nullable: NULL = global club, shown in every live
-- city's grid (owner classification in docs/global-club-candidates.md).
--
-- DDL only — marking the actual clubs global happens AFTER the code that
-- reads "cityId IS NULL" deploys (scripts/mark-global-clubs.sql), so
-- there is no window where global clubs vanish from the old code's
-- city-filtered lists.

ALTER TABLE "clubs" ALTER COLUMN "cityId" DROP NOT NULL;
