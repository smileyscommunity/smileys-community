-- Bridges the two vocabularies that never matched: members pick TOPIC
-- interests (sailing, dining, games…) while events are tagged by VIBE
-- (Social, Chill, Adventure…). Without this map the "Your First Event"
-- matcher scores interest overlap at ~zero. Topic interests with no vibe
-- equivalent (sailing, games) map to their nearest experience tag rather
-- than polluting the deliberate vibe taxonomy with topic tags.
--
-- Seed covers all 8 canonical application interests
-- (app/admin/applications/page.tsx). Tag IDs are the stable t_* ids.

CREATE TABLE "interest_tag_map" (
    "interest" TEXT NOT NULL,
    "tagId"    TEXT NOT NULL,
    CONSTRAINT "interest_tag_map_pkey" PRIMARY KEY ("interest", "tagId"),
    CONSTRAINT "interest_tag_map_tagId_fkey" FOREIGN KEY ("tagId")
        REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "interest_tag_map_tagId_idx" ON "interest_tag_map"("tagId");

-- Clean mappings (interest has a direct vibe/experience equivalent)
INSERT INTO "interest_tag_map" ("interest", "tagId") VALUES
    ('social',     't_social'),
    ('dining',     't_food'),
    ('wellness',   't_wellness'),
    ('networking', 't_networking'),
    ('outdoor',    't_outdoor'),
    ('outdoor',    't_adventure'),
    ('languages',  't_learning'),
    ('languages',  't_cultural'),
    -- Approximate mappings (topic has no vibe tag → nearest experience)
    ('sailing',    't_adventure'),
    ('sailing',    't_outdoor'),
    ('games',      't_social');
