-- Tie listings to the neighborhood vocabulary already used by Users, Events,
-- and Neighborhood pages. Unblocks "find me a flat in Moda" — the #1 housing
-- filter for an expat marketplace and the obvious link to the existing
-- Neighborhoods system.

ALTER TABLE "listings" ADD COLUMN "neighborhood" TEXT;
CREATE INDEX "listings_neighborhood_status_idx" ON "listings" ("neighborhood", "status");
