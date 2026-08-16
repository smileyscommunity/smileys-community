-- Rollback for 20260816000004_event_sold_out. Drops which events were manually
-- marked sold out; events at capacity still read as sold out from the counter,
-- so what's lost is only the human override.
--
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260816000004_event_sold_out';

ALTER TABLE "events" DROP COLUMN IF EXISTS "soldOut";
