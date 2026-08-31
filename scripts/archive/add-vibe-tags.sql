-- EXECUTED 2026-08 (see git log) — archived one-off, do not re-run.
-- Expand the vibe-tag taxonomy (2026-08-16, approved by Nate):
--   Experience +8: Music, Sports, Games, Nightlife, Dance, Film, On the water, Books
--   Purpose    +4: Language exchange, Giving back, Celebration, Support
-- Plus exact-match interest mappings for the "Your First Event" matcher
-- (additive — existing mappings for these interests are kept).
-- Idempotent: ON CONFLICT DO NOTHING throughout; safe to re-run.

BEGIN;

INSERT INTO tags (id, name, emoji, "groupId") VALUES
  ('t_music',             'Music',             '🎶', 'tg_experience'),
  ('t_sports',            'Sports',            '⚽', 'tg_experience'),
  ('t_games',             'Games',             '🎲', 'tg_experience'),
  ('t_nightlife',         'Nightlife',         '🌃', 'tg_experience'),
  ('t_dance',             'Dance',             '💃', 'tg_experience'),
  ('t_film',              'Film',              '🎬', 'tg_experience'),
  ('t_water',             'On the water',      '🚤', 'tg_experience'),
  ('t_books',             'Books',             '📖', 'tg_experience'),
  ('t_language_exchange', 'Language exchange', '🗣️', 'tg_purpose'),
  ('t_giving_back',       'Giving back',       '💛', 'tg_purpose'),
  ('t_celebration',       'Celebration',       '🥂', 'tg_purpose'),
  ('t_support',           'Support',           '🫂', 'tg_purpose')
ON CONFLICT (id) DO NOTHING;

INSERT INTO interest_tag_map (interest, "tagId") VALUES
  ('games',     't_games'),
  ('languages', 't_language_exchange'),
  ('sailing',   't_water')
ON CONFLICT (interest, "tagId") DO NOTHING;

-- Show the result for eyeballing before COMMIT (run with -c or \i inside a txn).
SELECT g.name AS grp, t.id, t.name, t.emoji
FROM tags t JOIN tag_groups g ON g.id = t."groupId"
ORDER BY g."sortOrder", t.name;

COMMIT;
