-- Rollback for 20260816000003_testimonial_city.
--
-- Dropping the column discards which city each quote came from — that
-- attribution is not recoverable from anything else in the table, so take the
-- backup seriously before running this. Afterwards the old reading code shows
-- every quote in every city again (the bug), so only roll back together with
-- the code.
--
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260816000003_testimonial_city';

BEGIN;

DROP INDEX IF EXISTS "testimonials_cityId_active_order_idx";

ALTER TABLE "testimonials" DROP CONSTRAINT IF EXISTS "testimonials_cityId_fkey";

ALTER TABLE "testimonials" DROP COLUMN IF EXISTS "cityId";

COMMIT;
