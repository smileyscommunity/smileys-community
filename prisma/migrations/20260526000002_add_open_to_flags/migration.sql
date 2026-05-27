-- "Open to…" availability flags on User. Surfaced as badges on member cards
-- and as filters on /members; pair naturally with /visiting (openToHosting,
-- openToCoffee) and future hangouts (openToCoffee).

ALTER TABLE "users" ADD COLUMN "openToCoffee"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "openToLanguage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "openToHosting"  BOOLEAN NOT NULL DEFAULT false;
