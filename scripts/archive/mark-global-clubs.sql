-- EXECUTED 2026-08 (see git log) — archived one-off, do not re-run.
-- Mark the owner-classified global clubs (2026-08-16): every Language club
-- and every Culture club EXCEPT Architecture (categorized Culture in the DB
-- but an activity club, kept Istanbul-local — see
-- docs/global-club-candidates.md "judgement calls").
--
-- Run AFTER deploying the code that includes cityId IS NULL in club reads.
-- Idempotent; guarded to the two categories only. Rollback: the migration's
-- rollback.sql re-localizes NULLs to Istanbul.

BEGIN;

UPDATE "clubs"
SET "cityId" = NULL
WHERE "cityId" IS NOT NULL
  AND (category = 'Language' OR (category = 'Culture' AND name <> 'Architecture'));

-- Eyeball before COMMIT when running interactively:
SELECT category, count(*) FILTER (WHERE "cityId" IS NULL) AS global, count(*) AS total
FROM "clubs" GROUP BY category ORDER BY category;

COMMIT;
