-- A season axis for guide experiences (§15 of the Bodrum Guide brief).
--
-- Bodrum is not a July-and-August destination: the sea is warm into October,
-- spring is for walking and villages, and winter is when local life shows.
-- `when` already existed but is display copy — "Late afternoon for the light" —
-- so nothing could group or filter by season. This column can.
--
-- Empty default means every existing entry keeps behaving exactly as it does:
-- no seasons tagged = relevant all year, which is true of most of them.
-- PG11+ fills a NOT NULL DEFAULT without rewriting, so this is instant.

ALTER TABLE "guide_entries" ADD COLUMN "seasons" TEXT[] NOT NULL DEFAULT '{}';
