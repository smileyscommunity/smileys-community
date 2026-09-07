-- The apply form and activation page now ask for the acceptances comparable
-- communities ask for and this one never did (2026-09-08): the Terms and
-- Privacy Policy with an 18+ confirmation (recorded, so it can be shown when
-- it was given), and marketing email as an unticked choice rather than a
-- default-on flag. Existing members keep their current marketing setting.
ALTER TABLE "member_applications" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "member_applications" ADD COLUMN "emailMarketing" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
