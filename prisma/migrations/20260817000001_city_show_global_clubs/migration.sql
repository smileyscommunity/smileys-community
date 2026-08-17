-- Per-city control over whether the GLOBAL clubs (cityId null — Cultures of
-- the World, Language) appear in a city's club grid.
--
-- Bodrum launched with 35 clubs in its grid, 32 of them these globals: 18
-- Culture + 14 Language clubs whose 1,519 memberships were 1,517 Istanbul
-- members and 2 Antalya, and zero Bodrum. They pushed Bodrum's own three clubs
-- below a wall of communities with nobody nearby.
--
-- Default false, then Istanbul opted back in below: a city launched from here
-- on starts with only its own clubs, and the globals are switched on per city
-- once those communities actually have members there. Istanbul is the only
-- city whose grid changes nothing.
--
-- The UPDATE is the point of this migration, not a convenience — the column
-- alone would silently empty Istanbul's Culture and Language sections. Run it
-- with `prisma migrate deploy` (never `db push`, which skips this body).
-- Idempotent: re-running sets the same row to the same value.

ALTER TABLE "cities" ADD COLUMN "showGlobalClubs" BOOLEAN NOT NULL DEFAULT false;

UPDATE "cities" SET "showGlobalClubs" = true WHERE "slug" = 'istanbul';
