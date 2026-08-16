-- Rollback for 20260816000003_city_relationship_notified. Run manually, then:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260816000003_city_relationship_notified';

ALTER TABLE "city_relationships" DROP COLUMN "notifiedAt";
