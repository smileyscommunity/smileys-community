-- A broadcast row is now written BEFORE its fan-out, so the history can say
-- "sending…" instead of being empty for the ~16 minutes a whole-membership
-- email takes. finishedAt null = still running. The per-channel counts split
-- a single "sentCount" that meant emails on one channel and in-app rows on
-- the other. sentById keeps the sender by id, not by a changeable name.
-- Additive and nullable. finishedAt IS backfilled: every existing row is a
-- finished send, and left null it would read as "sending…" for ever.
ALTER TABLE "broadcasts" ADD COLUMN "sentById"      TEXT;
ALTER TABLE "broadcasts" ADD COLUMN "emailedCount"  INTEGER;
ALTER TABLE "broadcasts" ADD COLUMN "notifiedCount" INTEGER;
ALTER TABLE "broadcasts" ADD COLUMN "finishedAt"    TIMESTAMP(3);
UPDATE "broadcasts" SET "finishedAt" = "createdAt" WHERE "finishedAt" IS NULL;
