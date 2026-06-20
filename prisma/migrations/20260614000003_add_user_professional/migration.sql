-- Professional profile fields — opt-in surface that powers the upcoming
-- Pro network filters without leaking into the social feed. All three
-- nullable so existing rows stay valid and members opt in over time.

ALTER TABLE "users" ADD COLUMN "industry"           TEXT;
ALTER TABLE "users" ADD COLUMN "professionalRole"   TEXT;
ALTER TABLE "users" ADD COLUMN "professionalStatus" TEXT;
