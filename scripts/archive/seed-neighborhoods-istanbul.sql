-- Multi-city phase 1, step 2: create + seed the neighborhoods table BEFORE
-- deploying the code that validates against it.
--
-- Why this exists: the per-city neighborhood registry replaces the hardcoded
-- ISTANBUL_NEIGHBORHOODS validation in ~13 API sites. Those validators read
-- this table — deployed against an empty table, every neighborhood tag would
-- silently validate to NULL until the seed ran. Running this first (same
-- pattern as backfill-city-ids.sql) closes that window; the deploy's
-- `prisma db push` then sees a matching table and has nothing to do.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + per-row INSERT ... ON CONFLICT DO
-- NOTHING, so re-running never duplicates and never clobbers admin edits.
-- Generated from lib/neighborhoods.ts NEIGHBORHOOD_META by the tsx one-liner
-- in the repo (see git log for this file); regenerate rather than hand-edit.

CREATE TABLE IF NOT EXISTS "neighborhoods" (
  "id"        TEXT NOT NULL,
  "cityId"    TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "slug"      TEXT NOT NULL,
  "emoji"     TEXT NOT NULL DEFAULT '📍',
  "vibe"      TEXT,
  "area"      TEXT,
  "cost"      INTEGER NOT NULL DEFAULT 2,
  "lat"       DOUBLE PRECISION,
  "lng"       DOUBLE PRECISION,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "neighborhoods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "neighborhoods_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "neighborhoods_cityId_slug_key" ON "neighborhoods"("cityId", "slug");
CREATE UNIQUE INDEX IF NOT EXISTS "neighborhoods_cityId_name_key" ON "neighborhoods"("cityId", "name");
CREATE INDEX IF NOT EXISTS "neighborhoods_cityId_active_sortOrder_idx" ON "neighborhoods"("cityId", "active", "sortOrder");

INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('0', 3, '0'), c.id, 'Kadıköy', 'kadikoy', '🎨', 'Artsy & vibrant', 'Central', 2, 40.9906, 29.0234, 0
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('1', 3, '0'), c.id, 'Moda', 'moda', '☕', 'Laid-back & local', 'Central', 2, 40.9854, 29.027, 1
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('2', 3, '0'), c.id, 'Beşiktaş', 'besiktas', '⚡', 'Lively & social', 'Central', 2, 41.0438, 29.0045, 2
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('3', 3, '0'), c.id, 'Beyoğlu', 'beyoglu', '🌃', 'Culture & nightlife', 'Central', 2, 41.0351, 28.9773, 3
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('4', 3, '0'), c.id, 'Karaköy', 'karakoy', '🖼️', 'Galleries & coffee', 'Central', 2, 41.0242, 28.9742, 4
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('5', 3, '0'), c.id, 'Galata', 'galata', '🏰', 'Historic & charming', 'Central', 2, 41.0261, 28.9741, 5
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('6', 3, '0'), c.id, 'Cihangir', 'cihangir', '🎭', 'Bohemian & creative', 'Central', 2, 41.0345, 28.9817, 6
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('7', 3, '0'), c.id, 'Nişantaşı', 'nisantasi', '👜', 'Upscale & fashionable', 'Central', 3, 41.051, 28.995, 7
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('8', 3, '0'), c.id, 'Teşvikiye', 'tesvikiye', '🌹', 'Quiet luxury & boutiques', 'Central', 3, 41.0508, 28.9986, 8
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('9', 3, '0'), c.id, 'Taksim', 'taksim', '🎶', 'Central & buzzing', 'Central', 2, 41.0369, 28.985, 9
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('10', 3, '0'), c.id, 'Ortaköy', 'ortakoy', '🕌', 'Iconic & scenic', 'Central', 2, 41.0479, 29.028, 10
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('11', 3, '0'), c.id, 'Balat', 'balat', '🌈', 'Colourful & artsy', 'Central', 1, 41.0265, 28.947, 11
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('12', 3, '0'), c.id, 'Şişli', 'sisli', '🏙️', 'Business & fashion', 'European', 2, 41.0604, 28.9873, 12
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('13', 3, '0'), c.id, 'Levent', 'levent', '🏢', 'Corporate & modern', 'European', 3, 41.0799, 29.0103, 13
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('14', 3, '0'), c.id, 'Maslak', 'maslak', '🌆', 'Skyscrapers & business', 'European', 2, 41.109, 29.0178, 14
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('15', 3, '0'), c.id, 'Etiler', 'etiler', '🌿', 'Leafy & affluent', 'European', 3, 41.0777, 29.0346, 15
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('16', 3, '0'), c.id, 'Bomonti', 'bomonti', '🍺', 'Up-and-coming', 'European', 2, 41.0624, 28.9803, 16
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('17', 3, '0'), c.id, 'Bebek', 'bebek', '🛥️', 'Bosphorus & affluent', 'European', 3, 41.0775, 29.043, 17
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('18', 3, '0'), c.id, 'Arnavutköy', 'arnavutkoy', '🏡', 'Village charm on the Bosphorus', 'European', 3, 41.0656, 29.05, 18
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('19', 3, '0'), c.id, 'Fener', 'fener', '⛪', 'Historic & multicultural', 'European', 1, 41.031, 28.944, 19
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('20', 3, '0'), c.id, 'Eminönü', 'eminonu', '⚓', 'Spice bazaar & port', 'European', 1, 41.0177, 28.9686, 20
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('21', 3, '0'), c.id, 'Sultanahmet', 'sultanahmet', '🏛️', 'Historic heart', 'European', 2, 41.0055, 28.976, 21
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('22', 3, '0'), c.id, 'Fındıklı', 'findikli', '🌊', 'Waterfront arts', 'European', 2, 41.0282, 28.9918, 22
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('23', 3, '0'), c.id, 'Kabataş', 'kabatas', '🚢', 'Ferry hub & views', 'European', 2, 41.0327, 28.9991, 23
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('24', 3, '0'), c.id, 'Fulya', 'fulya', '🌿', 'Trendy & residential', 'European', 2, 41.0574, 29.0015, 24
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('25', 3, '0'), c.id, 'Gayrettepe', 'gayrettepe', '💼', 'Business & metro hub', 'European', 2, 41.0699, 29.0053, 25
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('26', 3, '0'), c.id, 'Mecidiyeköy', 'mecidiyekoy', '🚇', 'Bustling transit hub', 'European', 2, 41.0673, 29.0003, 26
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('27', 3, '0'), c.id, 'Ulus', 'ulus', '🌲', 'Affluent & leafy', 'European', 3, 41.0729, 29.0415, 27
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('28', 3, '0'), c.id, 'Pierre Loti', 'pierre-loti', '☕', 'Hilltop views & tea gardens', 'European', 1, 41.05, 28.931, 28
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('29', 3, '0'), c.id, 'Fatih', 'fatih', '🕌', 'Traditional & historic', 'European', 1, 41.0205, 28.9415, 29
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('30', 3, '0'), c.id, 'Aksaray', 'aksaray', '🌍', 'International & street food', 'European', 1, 41.0143, 28.9519, 30
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('31', 3, '0'), c.id, 'Eyüpsultan', 'eyupsultan', '🌙', 'Spiritual & serene', 'European', 1, 41.0472, 28.9262, 31
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('32', 3, '0'), c.id, 'Bakırköy', 'bakirkoy', '🛍️', 'Shopping & social', 'European', 2, 40.9801, 28.873, 32
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('33', 3, '0'), c.id, 'Zeytinburnu', 'zeytinburnu', '🧵', 'Industrial & local', 'European', 1, 41.0007, 28.9018, 33
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('34', 3, '0'), c.id, 'Üsküdar', 'uskudar', '🌅', 'Traditional & scenic', 'Asian', 2, 41.0264, 29.0148, 34
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('35', 3, '0'), c.id, 'Kuzguncuk', 'kuzguncuk', '🌸', 'Village charm & cafés', 'Asian', 2, 41.0412, 29.0382, 35
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('36', 3, '0'), c.id, 'Beylerbeyi', 'beylerbeyi', '🏰', 'Palace views & quiet', 'Asian', 2, 41.0396, 29.0389, 36
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('37', 3, '0'), c.id, 'Çengelköy', 'cengelkoy', '🌳', 'Quiet & scenic', 'Asian', 2, 41.0482, 29.062, 37
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('38', 3, '0'), c.id, 'Acıbadem', 'acibadem', '🏥', 'Calm & residential', 'Asian', 2, 41.0065, 29.0379, 38
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('39', 3, '0'), c.id, 'Altunizade', 'altunizade', '🌆', 'Modern & well-connected', 'Asian', 2, 41.0215, 29.0498, 39
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('40', 3, '0'), c.id, 'Fenerbahçe', 'fenerbahce', '⚽', 'Sporty & scenic', 'Asian', 2, 40.975, 29.0399, 40
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('41', 3, '0'), c.id, 'Caddebostan', 'caddebostan', '🏖️', 'Beachside & social', 'Asian', 2, 40.9633, 29.062, 41
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('42', 3, '0'), c.id, 'Suadiye', 'suadiye', '🌊', 'Breezy & relaxed', 'Asian', 3, 40.9578, 29.0726, 42
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('43', 3, '0'), c.id, 'Erenköy', 'erenkoy', '🌳', 'Green & residential', 'Asian', 2, 40.9685, 29.061, 43
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('44', 3, '0'), c.id, 'Kozyatağı', 'kozyatagi', '💼', 'Business & lifestyle', 'Asian', 2, 40.9871, 29.0907, 44
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('45', 3, '0'), c.id, 'Göztepe', 'goztepe', '🌺', 'Quiet & traditional', 'Asian', 1, 40.976, 29.061, 45
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('46', 3, '0'), c.id, 'Bostancı', 'bostanci', '🌳', 'Relaxed & local', 'Asian', 1, 40.9622, 29.0988, 46
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('47', 3, '0'), c.id, 'Feneryolu', 'feneryolu', '🏡', 'Quiet & residential', 'Asian', 1, 40.9694, 29.068, 47
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('48', 3, '0'), c.id, 'Ataşehir', 'atasehir', '🏗️', 'Modern & growing', 'Asian', 2, 40.9897, 29.1169, 48
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('49', 3, '0'), c.id, 'Beykoz', 'beykoz', '🌲', 'Forests & Bosphorus villages', 'Coastal', 2, 41.13, 29.094, 49
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('50', 3, '0'), c.id, 'Sarıyer', 'sariyer', '⛵', 'Bosphorus villages', 'Coastal', 2, 41.1656, 29.056, 50
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('51', 3, '0'), c.id, 'Tarabya', 'tarabya', '🎣', 'Serene & scenic', 'Coastal', 3, 41.1356, 29.0612, 51
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('52', 3, '0'), c.id, 'Yeniköy', 'yenikoy', '🌸', 'Charming & quiet', 'Coastal', 3, 41.1183, 29.0603, 52
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('53', 3, '0'), c.id, 'Zekeriyaköy', 'zekeriyakoy', '🌲', 'Forest retreat', 'Coastal', 3, 41.1824, 29.0272, 53
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('54', 3, '0'), c.id, 'Ataköy', 'atakoy', '🏖️', 'Beachside & modern', 'Coastal', 2, 40.9848, 28.8683, 54
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('55', 3, '0'), c.id, 'Yeşilköy', 'yesilkoy', '🌅', 'Seaside calm', 'Coastal', 2, 40.962, 28.8275, 55
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('56', 3, '0'), c.id, 'Florya', 'florya', '🌬️', 'Breezy coastal', 'Coastal', 2, 40.9727, 28.7969, 56
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('57', 3, '0'), c.id, 'Emirgan', 'emirgan', '🌷', 'Tulip gardens & Bosphorus', 'Coastal', 3, 41.1107, 29.0546, 57
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('58', 3, '0'), c.id, 'Rumeli Hisarı', 'rumeli-hisari', '🏰', 'Fortress & Bosphorus views', 'Coastal', 3, 41.0874, 29.0588, 58
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('59', 3, '0'), c.id, 'İstinye', 'istinye', '⛵', 'Marina & northern Bosphorus', 'Coastal', 3, 41.1028, 29.0535, 59
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('60', 3, '0'), c.id, 'Büyükada', 'buyukada', '🚲', 'Car-free & grand', 'Islands', 2, 40.8762, 29.1262, 60
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('61', 3, '0'), c.id, 'Heybeliada', 'heybeliada', '🌲', 'Forested & serene', 'Islands', 2, 40.8793, 29.0862, 61
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('62', 3, '0'), c.id, 'Burgazada', 'burgazada', '⛵', 'Cosy island life', 'Islands', 2, 40.8783, 29.0573, 62
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('63', 3, '0'), c.id, 'Kınalıada', 'kinaliada', '🐑', 'Smallest & peaceful', 'Islands', 1, 40.903, 29.0374, 63
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('64', 3, '0'), c.id, 'Kağıthane', 'kagithane', '🏗️', 'Rising fast', 'Emerging', 1, 41.0783, 28.981, 64
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('65', 3, '0'), c.id, 'Güngören', 'gungoren', '🏘️', 'Residential & local', 'Emerging', 1, 41.02, 28.875, 65
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('66', 3, '0'), c.id, 'Gaziosmanpaşa', 'gaziosmanpasa', '🌆', 'Dense & bustling', 'Emerging', 1, 41.06, 28.9133, 66
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('67', 3, '0'), c.id, 'Başakşehir', 'basaksehir', '🏙️', 'New Istanbul', 'Emerging', 1, 41.0906, 28.8076, 67
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('68', 3, '0'), c.id, 'Beylikdüzü', 'beylikduzu', '🌊', 'Western coast living', 'Emerging', 1, 41.0074, 28.64, 68
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('69', 3, '0'), c.id, 'Büyükçekmece', 'buyukcekmece', '🌅', 'Coastal suburb', 'Emerging', 1, 41.0292, 28.5785, 69
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('70', 3, '0'), c.id, 'Küçükçekmece', 'kucukcekmece', '🏘️', 'Lake & suburb', 'Emerging', 1, 41.0168, 28.774, 70
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('71', 3, '0'), c.id, 'Esenyurt', 'esenyurt', '🏗️', 'Fast-growing district', 'Emerging', 1, 41.0301, 28.68, 71
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('72', 3, '0'), c.id, 'Bağcılar', 'bagcilar', '🚇', 'Metro-connected & busy', 'Emerging', 1, 41.037, 28.8562, 72
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('73', 3, '0'), c.id, 'Ümraniye', 'umraniye', '💡', 'Growing tech hub', 'Emerging', 1, 41.0185, 29.1226, 73
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('74', 3, '0'), c.id, 'Maltepe', 'maltepe', '🌊', 'Seaside & family', 'Emerging', 1, 40.9363, 29.1303, 74
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('75', 3, '0'), c.id, 'Kartal', 'kartal', '🌊', 'Marmara shore & modern', 'Emerging', 1, 40.9064, 29.1887, 75
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('76', 3, '0'), c.id, 'Pendik', 'pendik', '🚝', 'Airport gateway & growing', 'Emerging', 1, 40.8774, 29.2345, 76
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('77', 3, '0'), c.id, 'Dragos', 'dragos', '🏔️', 'Dramatic sea views', 'Emerging', 1, 40.9059, 29.175, 77
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('78', 3, '0'), c.id, 'Çekmeköy', 'cekmekoy', '🌿', 'Forest & suburban', 'Emerging', 1, 41.0353, 29.1847, 78
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('79', 3, '0'), c.id, 'Yakacık', 'yakacik', '🏘️', 'Quiet suburb', 'Emerging', 1, 40.9302, 29.2045, 79
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('80', 3, '0'), c.id, 'Alibeyköy', 'alibeykoy', '🏘️', 'Residential & local', 'Emerging', 1, 41.068, 28.938, 80
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('81', 3, '0'), c.id, 'Kemerburgaz', 'kemerburgaz', '🌲', 'Forest & retreat', 'Emerging', 2, 41.154, 28.897, 81
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('82', 3, '0'), c.id, 'Göktürk', 'gokturk', '🌳', 'Green suburb & villas', 'Emerging', 2, 41.142, 28.885, 82
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('83', 3, '0'), c.id, 'Bahçeşehir', 'bahcesehir', '🏙️', 'Planned suburb & families', 'Emerging', 1, 41.0641, 28.685, 83
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('84', 3, '0'), c.id, 'İçerenköy', 'icerenkoy', '🏘️', 'Calm & residential', 'Emerging', 1, 40.9855, 29.0937, 84
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('85', 3, '0'), c.id, 'Kayışdağı', 'kayisdagi', '🏘️', 'Residential & quiet', 'Emerging', 1, 40.989, 29.1, 85
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('86', 3, '0'), c.id, 'Cevizli', 'cevizli', '🌊', 'Marmara coast suburb', 'Emerging', 1, 40.918, 29.155, 86
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('87', 3, '0'), c.id, 'İdealtepe', 'idealtepe', '🌊', 'Seaside residential', 'Emerging', 1, 40.944, 29.108, 87
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('88', 3, '0'), c.id, 'Aydos', 'aydos', '🌲', 'Forest & nature escape', 'Emerging', 1, 40.92, 29.18, 88
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('89', 3, '0'), c.id, 'Avcılar', 'avcilar', '🎓', 'Coastal west & campus life', 'Emerging', 1, 40.9796, 28.7214, 89
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('90', 3, '0'), c.id, 'Bahçelievler', 'bahcelievler', '🏘️', 'Dense & residential', 'Emerging', 1, 41.0022, 28.859, 90
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('91', 3, '0'), c.id, 'Bayrampaşa', 'bayrampasa', '🏘️', 'Residential & local', 'Emerging', 1, 41.0353, 28.9127, 91
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('92', 3, '0'), c.id, 'Esenler', 'esenler', '🚌', 'Transit hub & local', 'Emerging', 1, 41.0433, 28.8817, 92
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('93', 3, '0'), c.id, 'Sultangazi', 'sultangazi', '🏗️', 'Fast-growing & residential', 'Emerging', 1, 41.1058, 28.8672, 93
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('94', 3, '0'), c.id, 'Silivri', 'silivri', '🌅', 'Far-west coastal escape', 'Emerging', 1, 41.0736, 28.2464, 94
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('95', 3, '0'), c.id, 'Çatalca', 'catalca', '🌾', 'Rural & green outskirts', 'Emerging', 1, 41.1436, 28.4614, 95
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('96', 3, '0'), c.id, 'Tuzla', 'tuzla', '⚓', 'Marina & seaside east', 'Emerging', 1, 40.8156, 29.2997, 96
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('97', 3, '0'), c.id, 'Sancaktepe', 'sancaktepe', '🏗️', 'Growing & residential', 'Emerging', 1, 41.0006, 29.2314, 97
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('98', 3, '0'), c.id, 'Sultanbeyli', 'sultanbeyli', '🏘️', 'Residential & local', 'Emerging', 1, 40.9686, 29.2678, 98
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('99', 3, '0'), c.id, 'Şile', 'sile', '🏖️', 'Black Sea beaches & escape', 'Coastal', 1, 41.1758, 29.6103, 99
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('100', 3, '0'), c.id, 'Galataport', 'galataport', '🛳️', 'Waterfront & cruise port', 'Central', 3, 41.0234, 28.9805, 100
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('101', 3, '0'), c.id, 'Maçka', 'macka', '🌳', 'Park & upscale calm', 'Central', 3, 41.0455, 28.9938, 101
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;
INSERT INTO "neighborhoods" ("id","cityId","name","slug","emoji","vibe","area","cost","lat","lng","sortOrder")
SELECT 'nbh_ist_' || lpad('102', 3, '0'), c.id, 'Kurtuluş', 'kurtulus', '🌈', 'Historic & multicultural', 'Central', 2, 41.0553, 28.9787, 102
FROM "cities" c WHERE c.slug = 'istanbul'
ON CONFLICT ("cityId","name") DO NOTHING;

-- Verify: SELECT count(*) FROM neighborhoods; -- expect 103
