-- Rename the club category 'Food & Drinks' to 'Food & Drink', matching the
-- story category and the /clubs filter label. Data only: no column, type or
-- index changes. The code accepts both names (lib/data LEGACY_CLUB_CATEGORIES),
-- so this can run before or after the code that knows the new name.
--
-- Rollback (no data lost — every row keeps its category, only the label moves):
--   UPDATE "clubs" SET "category" = 'Food & Drinks' WHERE "category" = 'Food & Drink';
UPDATE "clubs" SET "category" = 'Food & Drink' WHERE "category" = 'Food & Drinks';
