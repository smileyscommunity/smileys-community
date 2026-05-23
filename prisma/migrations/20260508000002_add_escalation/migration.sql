ALTER TABLE "reports"              ADD COLUMN IF NOT EXISTS "escalated"     BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE "reports"              ADD COLUMN IF NOT EXISTS "escalatedNote"  TEXT;
ALTER TABLE "reports"              ADD COLUMN IF NOT EXISTS "escalatedBy"    TEXT;
ALTER TABLE "reports"              ADD COLUMN IF NOT EXISTS "escalatedAt"    TIMESTAMP(3);

ALTER TABLE "member_applications"  ADD COLUMN IF NOT EXISTS "escalated"     BOOLEAN      NOT NULL DEFAULT false;
ALTER TABLE "member_applications"  ADD COLUMN IF NOT EXISTS "escalatedNote"  TEXT;
ALTER TABLE "member_applications"  ADD COLUMN IF NOT EXISTS "escalatedBy"    TEXT;
ALTER TABLE "member_applications"  ADD COLUMN IF NOT EXISTS "escalatedAt"    TIMESTAMP(3);
