-- Additive only: one column with a default. No backfill.
ALTER TABLE "posts" ADD COLUMN "commentsOff" BOOLEAN NOT NULL DEFAULT false;
