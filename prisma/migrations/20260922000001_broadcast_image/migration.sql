-- A broadcast may carry one image, shown in its email and on the in-app
-- announcement card it becomes. Additive and nullable on both tables: adding
-- a nullable column is instant in Postgres, which matters on notifications
-- (~187k rows). Nothing backfills — every existing row correctly has none.
ALTER TABLE "broadcasts"    ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "notifications" ADD COLUMN "imageUrl" TEXT;
