-- The apply form asks two structured things it used to ask as essays or not
-- at all (2026-09-08):
--   lookingFor    what the applicant hopes to find, the profile's own
--                 "looking for" options, so matching works from day one
--   referrerName  who told them about Smileys when the source is a friend —
--                 45% of applicants said "friend" and 3% carried a referral
--                 code, so the referral loop was getting no credit
ALTER TABLE "member_applications" ADD COLUMN "lookingFor" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "member_applications" ADD COLUMN "referrerName" TEXT;
