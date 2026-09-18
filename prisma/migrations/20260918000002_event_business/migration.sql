-- An event links to its directory listing by id. It used to be the venue name
-- alone, re-matched on every read, so any spelling drift ("Dozze" vs "Dozze
-- Kadıköy") silently dropped the link.
ALTER TABLE "events" ADD COLUMN "businessId" TEXT;
CREATE INDEX "events_businessId_idx" ON "events"("businessId");
ALTER TABLE "events" ADD CONSTRAINT "events_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every event whose venue name matches exactly one listing in its
-- own city (whitespace-collapsed, case-insensitive — the rule readers used),
-- plus the venue spellings the review-nudge sweep already aliased. Any
-- listing status: readers still show only approved + active ones, and a
-- pending listing approved later lights up without another pass.
WITH alias(loc, canon) AS (VALUES
  ('buka',                      'Buka Yeldeğirmeni'),
  ('blak coffee yeldeğirmeni',  'BLAK Coffee Co. Yeldeğirmeni'),
  ('blak yeldeğirmeni',         'BLAK Coffee Co. Yeldeğirmeni'),
  ('black coffee yeldeğirmeni', 'BLAK Coffee Co. Yeldeğirmeni')
),
ev AS (
  SELECT e.id, e."cityId",
         lower(regexp_replace(trim(coalesce(a.canon, e.location)), '\s+', ' ', 'g')) AS k
  FROM "events" e
  LEFT JOIN alias a ON a.loc = lower(regexp_replace(trim(e.location), '\s+', ' ', 'g'))
  WHERE e."businessId" IS NULL
),
m AS (
  SELECT ev.id AS event_id, min(b.id) AS business_id
  FROM ev
  JOIN "businesses" b
    ON b."cityId" = ev."cityId"
   AND lower(regexp_replace(trim(b.name), '\s+', ' ', 'g')) = ev.k
  GROUP BY ev.id
  HAVING count(*) = 1
)
UPDATE "events" e SET "businessId" = m.business_id
FROM m WHERE e.id = m.event_id;
