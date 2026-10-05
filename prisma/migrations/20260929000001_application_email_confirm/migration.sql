-- Double opt-in for membership applications (apply scan 2026-09-29, item 9).
ALTER TABLE "member_applications" ADD COLUMN "emailConfirmedAt" TIMESTAMP(3);
ALTER TABLE "member_applications" ADD COLUMN "confirmToken" TEXT;
CREATE UNIQUE INDEX "member_applications_confirmToken_key" ON "member_applications"("confirmToken");

-- Every application made before this change counts as confirmed: the flow
-- did not exist, and treating them as unconfirmed would lift their cooldowns.
UPDATE "member_applications" SET "emailConfirmedAt" = "createdAt" WHERE "emailConfirmedAt" IS NULL;
