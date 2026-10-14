-- Additive only: one nullable column. No backfill (null = nothing to disclose).
ALTER TABLE "posts" ADD COLUMN "disclosure" TEXT;
-- Rollback: ALTER TABLE "posts" DROP COLUMN "disclosure";
