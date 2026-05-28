-- Consolidate the apply form:
--   aboutCommunity replaces whyJoin + enjoyWith + goodCommunity
--   socialJudgment replaces groupBehavior + removedFromCommunity + toxicBehavior
-- Plus add fields collected on apply now (previously asked only at register
-- or via Settings post-approval):
--   languages       — multi-select chip on apply, copies to User on register
--   openToCoffee / openToLanguage / openToHosting — auto-set on User from
--   approved application so new members land discoverable in /members filters.
-- Old columns kept (nullable) so existing applications keep their answers
-- in the admin review UI.

ALTER TABLE "member_applications" ADD COLUMN "aboutCommunity" TEXT;
ALTER TABLE "member_applications" ADD COLUMN "socialJudgment" TEXT;
ALTER TABLE "member_applications" ADD COLUMN "languages"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "member_applications" ADD COLUMN "openToCoffee"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "member_applications" ADD COLUMN "openToLanguage" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "member_applications" ADD COLUMN "openToHosting"  BOOLEAN NOT NULL DEFAULT false;
