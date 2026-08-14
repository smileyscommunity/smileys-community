-- Multi-city phase 1, step 5: move the city status vocabulary to the one the
-- public site uses (lib/cities.ts): coming_soon | preparing | live | paused.
--
-- The only legacy value in the database is 'launching', which meant "seeded,
-- not fully open" — that is `preparing`. 'live' and 'paused' already match.
--
-- Run on prod BEFORE deploying the landing page. A city left on 'launching'
-- after the deploy is not in PUBLIC_STATUSES, so it silently disappears from
-- the homepage, the nav and the apply form rather than erroring — quiet enough
-- to miss, which is why this runs first.
--
--   psql "$(grep -m1 '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')" \
--     -1 -v ON_ERROR_STOP=1 -f scripts/migrate-city-status.sql
--
-- Idempotent: a second run matches nothing.

DO $$
DECLARE
  moved   bigint;
  unknown_status text;
BEGIN
  UPDATE cities SET status = 'preparing' WHERE status = 'launching';
  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'launching → preparing: % city(ies)', moved;

  -- Anything still outside the vocabulary would vanish from the public site
  -- without a word. Fail the transaction instead so it gets fixed by hand.
  SELECT string_agg(DISTINCT status, ', ') INTO unknown_status
  FROM cities
  WHERE status NOT IN ('coming_soon', 'preparing', 'live', 'paused');

  IF unknown_status IS NOT NULL THEN
    RAISE EXCEPTION 'Unrecognised city status(es): %. Add them to lib/cities.ts or correct the rows.', unknown_status;
  END IF;

  RAISE NOTICE 'All city statuses are valid.';
END $$;
