-- EXECUTED 2026-08 (see git log) — archived one-off, do not re-run.
-- Multi-city phase 1: add and backfill "cityId" on the nine tables that become
-- city-scoped, so `prisma db push` can finish the job.
--
-- Why this exists: prisma/schema.prisma declares those columns NOT NULL with no
-- @default, and every one of the tables already has rows. Prisma cannot add such
-- a column to a non-empty table, and deploy.sh runs `db push` non-interactively
-- — so without this the deploy reports a failed schema push (exit 90) and prod
-- ends up running new code against the old schema.
--
-- Each table gets ONE statement:
--   ALTER TABLE <t> ADD COLUMN IF NOT EXISTS "cityId" TEXT NOT NULL DEFAULT <istanbul>
-- Postgres 11+ adds a NOT NULL column with a default without rewriting the
-- table, so this is instant even on businesses (the largest at ~100 rows). The
-- default is the load-bearing part: it closes the window where the OLD code
-- inserts a row between this script and the deploy, which would leave a NULL and
-- make `db push` fail to set NOT NULL. The Prisma schema declares no @default,
-- so `db push` drops it right after — from then on every insert must name a
-- city, which is the invariant we actually want.
--
-- `posts` is deliberately absent: Post.cityId is nullable on purpose (null =
-- global content, shown in every city), and Prisma adds a nullable column to a
-- non-empty table without help.
--
-- Everything is backfilled to Istanbul. That isn't an assumption — Izmir exists
-- as a placeholder city with zero users, events and clubs, so there is no other
-- city these rows could belong to.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, plus an explicit backfill of any rows
-- that already have a NULL (the case where a previous run added the column
-- without a default). Safe to re-run, including after the deploy.
--
-- Run on prod BEFORE deploying the schema — order matters:
--   ssh root@178.105.37.133
--   cd /root/smileys-community
--   psql "$(grep -m1 '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')" \
--     -1 -v ON_ERROR_STOP=1 -f scripts/backfill-city-ids.sql
--
-- -1 wraps it in a single transaction: it either all lands or none of it does.

DO $$
DECLARE
  city_id   text;
  city_name text;
  t         text;
  n         bigint;
  fixed     bigint;
BEGIN
  SELECT id, name INTO STRICT city_id, city_name FROM cities WHERE slug = 'istanbul';
  RAISE NOTICE 'Backfill target: % (%)', city_name, city_id;

  FOREACH t IN ARRAY ARRAY[
    'partners',
    'businesses',
    'listings',
    'board_posts',
    'moving_sales',
    'hangouts',
    'visitor_announcements',
    'neighborhood_posts',
    'availability_pulses'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;

    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS "cityId" TEXT NOT NULL DEFAULT %L',
      t, city_id
    );

    -- Only ever non-zero on a re-run against a column added without a default.
    EXECUTE format('UPDATE %I SET "cityId" = %L WHERE "cityId" IS NULL', t, city_id);
    GET DIAGNOSTICS fixed = ROW_COUNT;

    IF fixed > 0 THEN
      RAISE NOTICE '  % — % rows, backfilled % null(s)', t, n, fixed;
    ELSE
      RAISE NOTICE '  % — % rows', t, n;
    END IF;
  END LOOP;

  RAISE NOTICE 'Done. Deploy now — db push drops the temporary defaults and adds the FKs and indexes.';
END $$;
