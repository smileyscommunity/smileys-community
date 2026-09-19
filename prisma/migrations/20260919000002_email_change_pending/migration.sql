-- A change of login email waits for the new address to be confirmed.
ALTER TABLE "email_verification_tokens" ADD COLUMN "newEmail" TEXT;
ALTER TABLE "email_verification_tokens" ADD COLUMN "tokenVersion" INTEGER;
