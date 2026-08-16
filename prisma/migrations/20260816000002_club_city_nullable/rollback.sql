-- Rollback for 20260816000002_club_city_nullable: re-localize global clubs
-- to the default city, then restore NOT NULL. Run manually, then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260816000002_club_city_nullable';

UPDATE "clubs" SET "cityId" = (SELECT id FROM "cities" WHERE slug = 'istanbul')
WHERE "cityId" IS NULL;

ALTER TABLE "clubs" ALTER COLUMN "cityId" SET NOT NULL;
