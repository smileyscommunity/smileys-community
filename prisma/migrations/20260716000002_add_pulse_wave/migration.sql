-- "✋ I'm free too" response to an availability pulse — one tap of mutual
-- signal before anyone has to compose a DM to a stranger. userId is a bare
-- column (no User FK), same pattern as waitlist entries; rows die with
-- their pulse via the cascade, so orphans are bounded by pulse lifetime.
-- The (pulseId, userId) unique keeps a wave idempotent per member.

CREATE TABLE "pulse_waves" (
    "id"        TEXT NOT NULL,
    "pulseId"   TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pulse_waves_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pulse_waves_pulseId_userId_key" ON "pulse_waves"("pulseId", "userId");

ALTER TABLE "pulse_waves" ADD CONSTRAINT "pulse_waves_pulseId_fkey" FOREIGN KEY ("pulseId")
    REFERENCES "availability_pulses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
