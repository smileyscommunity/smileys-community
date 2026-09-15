-- Standing v2 (lib/standingPolicy, lib/standing).
--
-- Additive only: nullable or defaulted columns on events, event_attendees and
-- users, and three new tables. No backfill — standing starts clean at
-- STANDING_STARTS_AT, and nothing from the v1 no-show cards carries over.
-- Generated with `prisma migrate diff` from the schema before this change.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "standingSubstitutionUsed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "cancelCutoffHours" INTEGER,
ADD COLUMN     "tierOverride" TEXT,
ADD COLUMN     "tierOverrideAt" TIMESTAMP(3),
ADD COLUMN     "tierOverrideById" TEXT;

-- AlterTable
ALTER TABLE "event_attendees" ADD COLUMN     "attendanceAutoResolvedAt" TIMESTAMP(3),
ADD COLUMN     "cancelledLate" BOOLEAN;

-- CreateTable
CREATE TABLE "standing_offences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attendeeId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "counts" BOOLEAN NOT NULL,
    "loggedReason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'open',
    "cardId" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputeNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "standing_offences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standing_cards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "shadow" BOOLEAN NOT NULL DEFAULT true,
    "triggeredAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromCardId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "standing_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standing_recoveries" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "attendeeId" TEXT,
    "source" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "standing_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "standing_offences_attendeeId_key" ON "standing_offences"("attendeeId");

-- CreateIndex
CREATE INDEX "standing_offences_userId_status_idx" ON "standing_offences"("userId", "status");

-- CreateIndex
CREATE INDEX "standing_offences_status_idx" ON "standing_offences"("status");

-- CreateIndex
CREATE INDEX "standing_offences_eventId_idx" ON "standing_offences"("eventId");

-- CreateIndex
CREATE INDEX "standing_cards_userId_status_idx" ON "standing_cards"("userId", "status");

-- CreateIndex
CREATE INDEX "standing_cards_status_shadow_idx" ON "standing_cards"("status", "shadow");

-- CreateIndex
CREATE UNIQUE INDEX "standing_recoveries_cardId_attendeeId_key" ON "standing_recoveries"("cardId", "attendeeId");

-- AddForeignKey
ALTER TABLE "standing_offences" ADD CONSTRAINT "standing_offences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_offences" ADD CONSTRAINT "standing_offences_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "event_attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_offences" ADD CONSTRAINT "standing_offences_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_offences" ADD CONSTRAINT "standing_offences_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "standing_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_cards" ADD CONSTRAINT "standing_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_recoveries" ADD CONSTRAINT "standing_recoveries_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "standing_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_recoveries" ADD CONSTRAINT "standing_recoveries_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "event_attendees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

