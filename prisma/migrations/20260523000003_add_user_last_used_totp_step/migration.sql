-- Highest TOTP step accepted, used to block replay of the same 6-digit code
-- within its 30s validity window. See app/api/auth/2fa/verify/route.ts.

ALTER TABLE "users" ADD COLUMN "lastUsedTotpStep" INTEGER;
