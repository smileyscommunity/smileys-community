-- Baseline. One migration that creates the whole schema as it stood on
-- 2026-09-02 (release 4d202ec). It replaces the 51 folders before it, whose
-- replay had been broken since May (an index on a column no migration
-- added) and which were missing most of what reached production through
-- `prisma db push` — a database could no longer be built from this repo.
-- Production and every existing database were marked as having applied it
-- (`prisma migrate resolve --applied`); nothing here ever ran there. The
-- old files, with their backfill bodies, remain in git history.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "color" TEXT NOT NULL DEFAULT '#f59e0b',
    "bio" TEXT,
    "neighborhood" TEXT,
    "neighborhoodVisible" BOOLEAN NOT NULL DEFAULT true,
    "instagram" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "interests" TEXT[],
    "languages" TEXT[],
    "lastActive" TIMESTAMP(3),
    "nudgesSent" INTEGER NOT NULL DEFAULT 0,
    "lastNudgedAt" TIMESTAMP(3),
    "firstRsvpNudgedAt" TIMESTAMP(3),
    "foundingMember" BOOLEAN NOT NULL DEFAULT false,
    "membershipType" TEXT NOT NULL DEFAULT 'free',
    "nationality" TEXT,
    "phone" TEXT,
    "profilePhoto" TEXT,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "hiddenFromMembers" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "bannedAt" TIMESTAMP(3),
    "gender" TEXT,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "referralCode" TEXT,
    "referralCount" INTEGER NOT NULL DEFAULT 0,
    "appealNote" TEXT,
    "appealStatus" TEXT,
    "appealedAt" TIMESTAMP(3),
    "checkedInCount" INTEGER NOT NULL DEFAULT 0,
    "partnerId" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendedBy" TEXT,
    "suspendedUntil" TIMESTAMP(3),
    "suspensionNote" TEXT,
    "linkedin" TEXT,
    "lookingFor" TEXT[],
    "profileVisibility" TEXT NOT NULL DEFAULT 'everyone',
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "socialStyles" TEXT[],
    "emailMarketing" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "knownIps" TEXT[],
    "loginLockedUntil" TIMESTAMP(3),
    "listingAlerts" TEXT[],
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastUsedTotpStep" INTEGER,
    "openToCoffee" BOOLEAN NOT NULL DEFAULT false,
    "openToHosting" BOOLEAN NOT NULL DEFAULT false,
    "openToLanguage" BOOLEAN NOT NULL DEFAULT false,
    "goodHangouts" INTEGER NOT NULL DEFAULT 0,
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "lastFingerprint" TEXT,
    "cityId" TEXT NOT NULL,
    "fingerprints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "industry" TEXT,
    "professionalRole" TEXT,
    "professionalStatus" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_views" (
    "id" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "viewedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_blocks" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "discount" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "logo" TEXT,
    "coverImage" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsor_leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "dealValue" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsor_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "eventId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "screenshot" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalatedNote" TEXT,
    "escalatedBy" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "listingId" TEXT,
    "boardPostId" TEXT,
    "neighborhoodPostId" TEXT,
    "surveyId" TEXT,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacklist" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "reason" TEXT NOT NULL,
    "bannedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fingerprint" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'approved',

    CONSTRAINT "club_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "defaultLang" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'coming_soon',
    "tagline" TEXT,
    "description" TEXT,
    "heroImage" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "showGlobalClubs" BOOLEAN NOT NULL DEFAULT false,
    "consulUserId" TEXT,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_relationships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "city_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_entries" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '✨',
    "tagline" TEXT NOT NULL,
    "collection" TEXT,
    "moods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cost" TEXT,
    "time" TEXT,
    "when" TEXT,
    "seasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "neighborhoods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstTime" BOOLEAN NOT NULL DEFAULT false,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),
    "reviewIntervalDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neighborhoods" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '📍',
    "vibe" TEXT,
    "area" TEXT,
    "cost" INTEGER NOT NULL DEFAULT 2,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neighborhoods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_hosts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "city_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clubs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "bgColor" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "templateKey" TEXT,
    "coverImage" TEXT,
    "foundedAt" TIMESTAMP(3),
    "instagramUrl" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "rules" TEXT,
    "whatsappUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "spotlightUserId" TEXT,
    "spotlightNote" TEXT,
    "spotlightUpdatedAt" TIMESTAMP(3),
    "coverImagePosition" INTEGER NOT NULL DEFAULT 50,
    "cityId" TEXT,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🎉',
    "price" INTEGER NOT NULL DEFAULT 0,
    "memberPrice" INTEGER,
    "payTo" TEXT NOT NULL DEFAULT 'venue',
    "paymentContact" TEXT,
    "ticketUrl" TEXT,
    "totalSpots" INTEGER NOT NULL,
    "spotsLeft" INTEGER NOT NULL,
    "limitedSpots" BOOLEAN NOT NULL DEFAULT false,
    "soldOut" BOOLEAN NOT NULL DEFAULT false,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "membersOnly" BOOLEAN NOT NULL DEFAULT false,
    "isFirstTimerFriendly" BOOLEAN NOT NULL DEFAULT false,
    "intent" TEXT NOT NULL DEFAULT 'social',
    "vibes" TEXT[],
    "clubId" TEXT,
    "hostId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "whatsappUrl" TEXT,
    "address" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "coverImage" TEXT,
    "difficulty" TEXT,
    "duration" INTEGER,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "maxAge" INTEGER,
    "meetingUrl" TEXT,
    "minAge" INTEGER,
    "refundPolicy" TEXT,
    "registrationDeadline" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "endTime" TEXT,
    "genderBalance" BOOLEAN NOT NULL DEFAULT false,
    "maleQuota" INTEGER,
    "turkishMaleQuota" INTEGER,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "seriesId" TEXT,
    "coverImagePosition" INTEGER NOT NULL DEFAULT 50,
    "femaleQuota" INTEGER,
    "cityId" TEXT NOT NULL,
    "surveyDispatchedAt" TIMESTAMP(3),
    "surveyReminderAt" TIMESTAMP(3),
    "noShowProcessedAt" TIMESTAMP(3),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_photos" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_cohosts" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_cohosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_surveys" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "anomaly" BOOLEAN NOT NULL,
    "anomalyNote" TEXT,
    "wouldReturn" BOOLEAN NOT NULL,
    "returnDeclineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cup_fixtures" (
    "id" TEXT NOT NULL,
    "round" TEXT NOT NULL,
    "group" TEXT,
    "homeTeam" TEXT,
    "awayTeam" TEXT,
    "homeLabel" TEXT,
    "awayLabel" TEXT,
    "kickoffAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "winnerTeam" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "points" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminderSentAt" TIMESTAMP(3),
    "suggestedAt" TIMESTAMP(3),
    "suggestedAwayScore" INTEGER,
    "suggestedHomeScore" INTEGER,
    "suggestedStatus" TEXT,
    "suggestedWinnerTeam" TEXT,
    "suggestedAwayTeam" TEXT,
    "suggestedHomeTeam" TEXT,

    CONSTRAINT "cup_fixtures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cup_predictions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "pickedTeam" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cup_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cup_bracket_picks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "championPick" TEXT NOT NULL,
    "semifinalists" TEXT[],
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cup_bracket_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "tagline" TEXT,
    "description" TEXT,
    "coverImage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "routeSlug" TEXT NOT NULL DEFAULT 'cup',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hasFixtures" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cup_sponsors" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blurb" TEXT,
    "logoUrl" TEXT,
    "websiteUrl" TEXT,
    "instagramUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT,

    CONSTRAINT "cup_sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cup_prizes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "rank" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sponsorId" TEXT,
    "awardedToUserId" TEXT,
    "awardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT,

    CONSTRAINT "cup_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cup_prize_donations" (
    "id" TEXT NOT NULL,
    "donorName" TEXT NOT NULL,
    "donorEmail" TEXT NOT NULL,
    "donorOrganization" TEXT,
    "donorPhone" TEXT,
    "prizeTitle" TEXT NOT NULL,
    "prizeDescription" TEXT NOT NULL,
    "estimatedValue" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "linkedSponsorId" TEXT,
    "linkedPrizeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT,

    CONSTRAINT "cup_prize_donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_nps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "period" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_nps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🏷️',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🏷️',
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_tag_map" (
    "interest" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "interest_tag_map_pkey" PRIMARY KEY ("interest","tagId")
);

-- CreateTable
CREATE TABLE "event_recommendations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "reason" JSONB NOT NULL,
    "surface" TEXT NOT NULL DEFAULT 'first_event_block',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clickedAt" TIMESTAMP(3),
    "rsvpedAt" TIMESTAMP(3),

    CONSTRAINT "event_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_tags" (
    "eventId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "event_tags_pkey" PRIMARY KEY ("eventId","tagId")
);

-- CreateTable
CREATE TABLE "event_attendees" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "stealth" BOOLEAN NOT NULL DEFAULT false,
    "attendance" TEXT NOT NULL DEFAULT 'unknown',
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "reconfirmAskedAt" TIMESTAMP(3),
    "reconfirmedAt" TIMESTAMP(3),

    CONSTRAINT "event_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "no_show_cards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "attendeeId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "appealDeadlineAt" TIMESTAMP(3),
    "restrictionStartsAt" TIMESTAMP(3),
    "restrictionEndsAt" TIMESTAMP(3),
    "restrictionNotifiedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedEventId" TEXT,
    "appealNote" TEXT,
    "appealedAt" TIMESTAMP(3),
    "appealStatus" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedById" TEXT,
    "waiveReason" TEXT,

    CONSTRAINT "no_show_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'card',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "notes" TEXT,
    "provider" TEXT,
    "transactionRef" TEXT,
    "reminderSentAt" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_applications" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "bio" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "city" TEXT,
    "instagram" TEXT,
    "linkedin" TEXT,
    "profession" TEXT,
    "reasonHere" TEXT,
    "timeInCity" TEXT,
    "enjoyWith" TEXT,
    "goodCommunity" TEXT,
    "interests" TEXT[],
    "whyJoin" TEXT,
    "contribution" TEXT,
    "groupBehavior" TEXT,
    "removedFromCommunity" TEXT,
    "toxicBehavior" TEXT,
    "profilePhoto" TEXT,
    "assignedClubs" TEXT[],
    "suggestedBy" TEXT,
    "suggestion" TEXT,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "neighborhood" TEXT,
    "country" TEXT,
    "birthdate" TEXT,
    "gender" TEXT,
    "referredBy" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalatedNote" TEXT,
    "escalatedBy" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "socialStyles" TEXT[],
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "fingerprint" TEXT,
    "disposableEmail" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "timezoneMismatch" BOOLEAN NOT NULL DEFAULT false,
    "aboutCommunity" TEXT,
    "languages" TEXT[],
    "openToCoffee" BOOLEAN NOT NULL DEFAULT false,
    "openToHosting" BOOLEAN NOT NULL DEFAULT false,
    "openToLanguage" BOOLEAN NOT NULL DEFAULT false,
    "socialJudgment" TEXT,
    "suspicionScore" INTEGER NOT NULL DEFAULT 0,
    "targetCityId" TEXT NOT NULL,

    CONSTRAINT "member_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_messages" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "event_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_backup_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "totpVerified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newEvents" BOOLEAN NOT NULL DEFAULT true,
    "reminders" BOOLEAN NOT NULL DEFAULT true,
    "eventUpdates" BOOLEAN NOT NULL DEFAULT true,
    "joinedEvents" BOOLEAN NOT NULL DEFAULT true,
    "quietHours" BOOLEAN NOT NULL DEFAULT false,
    "quietFrom" INTEGER NOT NULL DEFAULT 23,
    "quietTo" INTEGER NOT NULL DEFAULT 9,
    "wallReplies" BOOLEAN NOT NULL DEFAULT true,
    "wallPosts" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_logs" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "clubId" TEXT,
    "eventId" TEXT,
    "sentBy" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL DEFAULT 'in-app',
    "cityId" TEXT,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "targetType" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_runs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "totalErrors" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_failures" (
    "id" TEXT NOT NULL,
    "helper" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_posts" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "type" TEXT NOT NULL DEFAULT 'post',

    CONSTRAINT "club_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_post_likes" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emoji" TEXT NOT NULL DEFAULT '❤️',

    CONSTRAINT "club_post_likes_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "club_post_replies" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_post_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_polls" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "question" TEXT NOT NULL,

    CONSTRAINT "club_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_poll_options" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "club_poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_poll_votes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_resources" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🔗',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_photos" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_polls" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_poll_options" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "community_poll_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_poll_votes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "role" TEXT,
    "quote" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "photo" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cityId" TEXT,
    "userId" TEXT,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_photos" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "event" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "story_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" TEXT NOT NULL,
    "coverImage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "category" TEXT NOT NULL DEFAULT 'Community',
    "authorId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'community',
    "lastReviewedAt" TIMESTAMP(3),
    "reviewIntervalDays" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "officialSources" JSONB,
    "cityId" TEXT,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_likes" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "member_connections" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "pairKey" TEXT NOT NULL,

    CONSTRAINT "member_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_messages" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imageUrl" TEXT,
    "replyToId" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "direct_message_reactions" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_message_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neighborhood_posts" (
    "id" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "imageUrl" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "neighborhood_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neighborhood_post_likes" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '❤️',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neighborhood_post_likes_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "neighborhood_post_replies" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neighborhood_post_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" TEXT,
    "photo" TEXT,
    "photoPosition" INTEGER NOT NULL DEFAULT 50,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attrs" JSONB,
    "contact" TEXT,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "neighborhood" TEXT,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hangouts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT NOT NULL,
    "neighborhood" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedStartingAt" TIMESTAMP(3),
    "meetMode" TEXT NOT NULL DEFAULT 'group',
    "photo" TEXT,
    "activity" TEXT,
    "maxPeople" INTEGER,
    "clubId" TEXT,
    "eventId" TEXT,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "hangouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hangout_joins" (
    "id" TEXT NOT NULL,
    "hangoutId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hangout_joins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hangout_messages" (
    "id" TEXT NOT NULL,
    "hangoutId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hangout_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hangout_references" (
    "id" TEXT NOT NULL,
    "hangoutId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "vibe" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hangout_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_pulses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "neighborhood" TEXT,
    "note" TEXT,
    "until" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "availability_pulses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pulse_waves" (
    "id" TEXT NOT NULL,
    "pulseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulse_waves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_announcements" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "fromCity" TEXT,
    "intro" TEXT NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT NOT NULL,
    "neighborhood" TEXT,
    "contact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "travelerType" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lookingFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibility" TEXT NOT NULL DEFAULT 'members',
    "cityId" TEXT NOT NULL,

    CONSTRAINT "visitor_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_listings" (
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_listings_pkey" PRIMARY KEY ("userId","listingId")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "neighborhood" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "logo" TEXT,
    "coverImage" TEXT,
    "isExpatOwned" BOOLEAN NOT NULL DEFAULT false,
    "isExpatFriendly" BOOLEAN NOT NULL DEFAULT false,
    "languages" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedById" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "hours" JSONB,
    "memberDiscount" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cityId" TEXT NOT NULL,
    "placeId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "verifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_reviews" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "ownerReply" TEXT,
    "ownerReplyAt" TIMESTAMP(3),
    "ownerReplyById" TEXT,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_reports" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_saves" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_saves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "newsletters" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" TIMESTAMP(3),
    "segment" TEXT NOT NULL DEFAULT 'all',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "unsubscribeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "newsletters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_email_logs" (
    "id" TEXT NOT NULL,
    "newsletterId" TEXT NOT NULL,
    "resendId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletter_email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_claims" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_saves" (
    "userId" TEXT NOT NULL,
    "savedId" TEXT NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_saves_pkey" PRIMARY KEY ("userId","savedId")
);

-- CreateTable
CREATE TABLE "pro_waitlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "industry" TEXT,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waitlisted',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pro_waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_posts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "clubId" TEXT,
    "eventId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "neighborhood" TEXT,
    "tag" TEXT,
    "whenLabel" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "board_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_replies" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_interests" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_interests_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "board_saves" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_saves_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "moving_sales" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leavingOn" TEXT NOT NULL,
    "neighborhood" TEXT,
    "note" TEXT,
    "photo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cityId" TEXT NOT NULL,

    CONSTRAINT "moving_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moving_sale_items" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" TEXT,
    "claimed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "moving_sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_saves" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guide_saves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_tips" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cityId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_tips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guide_tip_likes" (
    "id" TEXT NOT NULL,
    "tipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guide_tip_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_saves" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_saves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateIndex
CREATE INDEX "users_cityId_status_idx" ON "users"("cityId", "status");

-- CreateIndex
CREATE INDEX "users_lastActive_idx" ON "users"("lastActive");

-- CreateIndex
CREATE INDEX "users_membershipType_idx" ON "users"("membershipType");

-- CreateIndex
CREATE INDEX "users_nationality_idx" ON "users"("nationality");

-- CreateIndex
CREATE INDEX "users_neighborhood_idx" ON "users"("neighborhood");

-- CreateIndex
CREATE INDEX "users_neighborhood_status_idx" ON "users"("neighborhood", "status");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_status_joinedAt_idx" ON "users"("status", "joinedAt");

-- CreateIndex
CREATE INDEX "profile_views_viewedId_createdAt_idx" ON "profile_views"("viewedId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "profile_views_viewerId_viewedId_key" ON "profile_views"("viewerId", "viewedId");

-- CreateIndex
CREATE INDEX "member_blocks_blockerId_idx" ON "member_blocks"("blockerId");

-- CreateIndex
CREATE UNIQUE INDEX "member_blocks_blockerId_blockedId_key" ON "member_blocks"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "partners_cityId_isActive_idx" ON "partners"("cityId", "isActive");

-- CreateIndex
CREATE INDEX "sponsor_leads_status_idx" ON "sponsor_leads"("status");

-- CreateIndex
CREATE INDEX "sponsor_leads_createdAt_idx" ON "sponsor_leads"("createdAt");

-- CreateIndex
CREATE INDEX "reports_reportedId_idx" ON "reports"("reportedId");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_listingId_idx" ON "reports"("listingId");

-- CreateIndex
CREATE INDEX "reports_neighborhoodPostId_idx" ON "reports"("neighborhoodPostId");

-- CreateIndex
CREATE INDEX "reports_boardPostId_idx" ON "reports"("boardPostId");

-- CreateIndex
CREATE INDEX "reports_surveyId_idx" ON "reports"("surveyId");

-- CreateIndex
CREATE UNIQUE INDEX "blacklist_email_key" ON "blacklist"("email");

-- CreateIndex
CREATE INDEX "club_memberships_clubId_status_idx" ON "club_memberships"("clubId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "club_memberships_userId_clubId_key" ON "club_memberships"("userId", "clubId");

-- CreateIndex
CREATE UNIQUE INDEX "cities_slug_key" ON "cities"("slug");

-- CreateIndex
CREATE INDEX "city_relationships_cityId_type_idx" ON "city_relationships"("cityId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "city_relationships_userId_cityId_key" ON "city_relationships"("userId", "cityId");

-- CreateIndex
CREATE INDEX "guide_entries_cityId_kind_status_sortOrder_idx" ON "guide_entries"("cityId", "kind", "status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "guide_entries_cityId_kind_slug_key" ON "guide_entries"("cityId", "kind", "slug");

-- CreateIndex
CREATE INDEX "neighborhoods_cityId_active_sortOrder_idx" ON "neighborhoods"("cityId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "neighborhoods_cityId_slug_key" ON "neighborhoods"("cityId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "neighborhoods_cityId_name_key" ON "neighborhoods"("cityId", "name");

-- CreateIndex
CREATE INDEX "city_hosts_cityId_idx" ON "city_hosts"("cityId");

-- CreateIndex
CREATE INDEX "city_hosts_userId_idx" ON "city_hosts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "city_hosts_userId_cityId_key" ON "city_hosts"("userId", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "clubs_slug_key" ON "clubs"("slug");

-- CreateIndex
CREATE INDEX "clubs_cityId_idx" ON "clubs"("cityId");

-- CreateIndex
CREATE INDEX "events_date_idx" ON "events"("date");

-- CreateIndex
CREATE INDEX "events_clubId_idx" ON "events"("clubId");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE INDEX "events_hostId_idx" ON "events"("hostId");

-- CreateIndex
CREATE INDEX "events_cityId_idx" ON "events"("cityId");

-- CreateIndex
CREATE INDEX "events_cityId_status_date_idx" ON "events"("cityId", "status", "date");

-- CreateIndex
CREATE INDEX "event_cohosts_eventId_idx" ON "event_cohosts"("eventId");

-- CreateIndex
CREATE INDEX "event_cohosts_userId_idx" ON "event_cohosts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "event_cohosts_eventId_userId_key" ON "event_cohosts"("eventId", "userId");

-- CreateIndex
CREATE INDEX "event_surveys_eventId_idx" ON "event_surveys"("eventId");

-- CreateIndex
CREATE INDEX "event_surveys_anomaly_idx" ON "event_surveys"("anomaly");

-- CreateIndex
CREATE UNIQUE INDEX "event_surveys_eventId_userId_key" ON "event_surveys"("eventId", "userId");

-- CreateIndex
CREATE INDEX "cup_fixtures_round_kickoffAt_idx" ON "cup_fixtures"("round", "kickoffAt");

-- CreateIndex
CREATE INDEX "cup_fixtures_reminderSentAt_kickoffAt_idx" ON "cup_fixtures"("reminderSentAt", "kickoffAt");

-- CreateIndex
CREATE INDEX "cup_predictions_userId_idx" ON "cup_predictions"("userId");

-- CreateIndex
CREATE INDEX "cup_predictions_fixtureId_idx" ON "cup_predictions"("fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "cup_predictions_userId_fixtureId_key" ON "cup_predictions"("userId", "fixtureId");

-- CreateIndex
CREATE UNIQUE INDEX "cup_bracket_picks_userId_key" ON "cup_bracket_picks"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_slug_key" ON "campaigns"("slug");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cup_sponsors_slug_key" ON "cup_sponsors"("slug");

-- CreateIndex
CREATE INDEX "cup_sponsors_campaignId_status_idx" ON "cup_sponsors"("campaignId", "status");

-- CreateIndex
CREATE INDEX "cup_prizes_campaignId_status_rank_idx" ON "cup_prizes"("campaignId", "status", "rank");

-- CreateIndex
CREATE INDEX "cup_prize_donations_campaignId_status_createdAt_idx" ON "cup_prize_donations"("campaignId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "member_nps_period_createdAt_idx" ON "member_nps"("period", "createdAt");

-- CreateIndex
CREATE INDEX "member_nps_score_idx" ON "member_nps"("score");

-- CreateIndex
CREATE UNIQUE INDEX "member_nps_userId_period_key" ON "member_nps"("userId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "tag_groups_name_key" ON "tag_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "interest_tag_map_tagId_idx" ON "interest_tag_map"("tagId");

-- CreateIndex
CREATE INDEX "event_recommendations_userId_createdAt_idx" ON "event_recommendations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "event_recommendations_eventId_idx" ON "event_recommendations"("eventId");

-- CreateIndex
CREATE INDEX "event_attendees_eventId_idx" ON "event_attendees"("eventId");

-- CreateIndex
CREATE INDEX "event_attendees_userId_idx" ON "event_attendees"("userId");

-- CreateIndex
CREATE INDEX "event_attendees_status_idx" ON "event_attendees"("status");

-- CreateIndex
CREATE INDEX "event_attendees_eventId_status_idx" ON "event_attendees"("eventId", "status");

-- CreateIndex
CREATE INDEX "event_attendees_userId_status_idx" ON "event_attendees"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_attendees_userId_eventId_key" ON "event_attendees"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "no_show_cards_attendeeId_key" ON "no_show_cards"("attendeeId");

-- CreateIndex
CREATE INDEX "no_show_cards_userId_status_idx" ON "no_show_cards"("userId", "status");

-- CreateIndex
CREATE INDEX "no_show_cards_eventId_idx" ON "no_show_cards"("eventId");

-- CreateIndex
CREATE INDEX "no_show_cards_status_restrictionStartsAt_idx" ON "no_show_cards"("status", "restrictionStartsAt");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_eventId_key" ON "reviews"("userId", "eventId");

-- CreateIndex
CREATE INDEX "payments_userId_idx" ON "payments"("userId");

-- CreateIndex
CREATE INDEX "payments_eventId_idx" ON "payments"("eventId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");

-- CreateIndex
CREATE INDEX "payments_eventId_status_idx" ON "payments"("eventId", "status");

-- CreateIndex
CREATE INDEX "payments_userId_eventId_status_idx" ON "payments"("userId", "eventId", "status");

-- CreateIndex
CREATE INDEX "member_applications_email_idx" ON "member_applications"("email");

-- CreateIndex
CREATE INDEX "member_applications_phone_idx" ON "member_applications"("phone");

-- CreateIndex
CREATE INDEX "member_applications_instagram_idx" ON "member_applications"("instagram");

-- CreateIndex
CREATE INDEX "member_applications_status_idx" ON "member_applications"("status");

-- CreateIndex
CREATE INDEX "member_applications_fingerprint_createdAt_idx" ON "member_applications"("fingerprint", "createdAt");

-- CreateIndex
CREATE INDEX "member_applications_ipAddress_createdAt_idx" ON "member_applications"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "member_applications_targetCityId_idx" ON "member_applications"("targetCityId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "event_messages_eventId_createdAt_idx" ON "event_messages"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "event_messages_userId_idx" ON "event_messages"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_key" ON "email_verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "totp_backup_codes_codeHash_key" ON "totp_backup_codes"("codeHash");

-- CreateIndex
CREATE INDEX "totp_backup_codes_userId_idx" ON "totp_backup_codes"("userId");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "waitlist_eventId_idx" ON "waitlist"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_userId_eventId_key" ON "waitlist"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_key" ON "notification_preferences"("userId");

-- CreateIndex
CREATE INDEX "payment_logs_paymentId_idx" ON "payment_logs"("paymentId");

-- CreateIndex
CREATE INDEX "audit_logs_adminId_idx" ON "audit_logs"("adminId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cron_runs_name_key" ON "cron_runs"("name");

-- CreateIndex
CREATE INDEX "email_failures_helper_idx" ON "email_failures"("helper");

-- CreateIndex
CREATE INDEX "email_failures_createdAt_idx" ON "email_failures"("createdAt");

-- CreateIndex
CREATE INDEX "club_posts_clubId_isPinned_createdAt_idx" ON "club_posts"("clubId", "isPinned" DESC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "club_post_replies_postId_createdAt_idx" ON "club_post_replies"("postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "club_polls_postId_key" ON "club_polls"("postId");

-- CreateIndex
CREATE INDEX "club_poll_options_pollId_idx" ON "club_poll_options"("pollId");

-- CreateIndex
CREATE INDEX "club_poll_votes_optionId_idx" ON "club_poll_votes"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "club_poll_votes_userId_pollId_key" ON "club_poll_votes"("userId", "pollId");

-- CreateIndex
CREATE INDEX "club_resources_clubId_order_idx" ON "club_resources"("clubId", "order");

-- CreateIndex
CREATE INDEX "club_photos_clubId_createdAt_idx" ON "club_photos"("clubId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "community_poll_votes_userId_pollId_key" ON "community_poll_votes"("userId", "pollId");

-- CreateIndex
CREATE INDEX "testimonials_active_order_idx" ON "testimonials"("active", "order");

-- CreateIndex
CREATE INDEX "testimonials_cityId_active_order_idx" ON "testimonials"("cityId", "active", "order");

-- CreateIndex
CREATE INDEX "testimonials_userId_idx" ON "testimonials"("userId");

-- CreateIndex
CREATE INDEX "story_photos_active_order_idx" ON "story_photos"("active", "order");

-- CreateIndex
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
CREATE INDEX "posts_status_publishedAt_idx" ON "posts"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "posts_kind_status_publishedAt_idx" ON "posts"("kind", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "posts_kind_status_lastReviewedAt_idx" ON "posts"("kind", "status", "lastReviewedAt");

-- CreateIndex
CREATE INDEX "posts_cityId_idx" ON "posts"("cityId");

-- CreateIndex
CREATE INDEX "post_likes_postId_idx" ON "post_likes"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "member_connections_pairKey_key" ON "member_connections"("pairKey");

-- CreateIndex
CREATE INDEX "member_connections_receiverId_idx" ON "member_connections"("receiverId");

-- CreateIndex
CREATE INDEX "member_connections_status_idx" ON "member_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "member_connections_requesterId_receiverId_key" ON "member_connections"("requesterId", "receiverId");

-- CreateIndex
CREATE INDEX "admin_notes_userId_idx" ON "admin_notes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE INDEX "direct_messages_fromId_toId_idx" ON "direct_messages"("fromId", "toId");

-- CreateIndex
CREATE INDEX "direct_messages_toId_isRead_idx" ON "direct_messages"("toId", "isRead");

-- CreateIndex
CREATE INDEX "direct_messages_createdAt_idx" ON "direct_messages"("createdAt");

-- CreateIndex
CREATE INDEX "direct_messages_replyToId_idx" ON "direct_messages"("replyToId");

-- CreateIndex
CREATE INDEX "direct_messages_deletedAt_idx" ON "direct_messages"("deletedAt");

-- CreateIndex
CREATE INDEX "direct_message_reactions_messageId_idx" ON "direct_message_reactions"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "direct_message_reactions_messageId_userId_key" ON "direct_message_reactions"("messageId", "userId");

-- CreateIndex
CREATE INDEX "neighborhood_posts_neighborhood_isPinned_createdAt_idx" ON "neighborhood_posts"("neighborhood", "isPinned" DESC, "createdAt" DESC);

-- CreateIndex
CREATE INDEX "neighborhood_posts_cityId_idx" ON "neighborhood_posts"("cityId");

-- CreateIndex
CREATE INDEX "neighborhood_post_replies_postId_createdAt_idx" ON "neighborhood_post_replies"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "listings_category_status_createdAt_idx" ON "listings"("category", "status", "createdAt");

-- CreateIndex
CREATE INDEX "listings_neighborhood_status_idx" ON "listings"("neighborhood", "status");

-- CreateIndex
CREATE INDEX "listings_userId_idx" ON "listings"("userId");

-- CreateIndex
CREATE INDEX "listings_cityId_status_createdAt_idx" ON "listings"("cityId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "hangouts_status_endsAt_idx" ON "hangouts"("status", "endsAt");

-- CreateIndex
CREATE INDEX "hangouts_status_startsAt_idx" ON "hangouts"("status", "startsAt");

-- CreateIndex
CREATE INDEX "hangouts_neighborhood_status_idx" ON "hangouts"("neighborhood", "status");

-- CreateIndex
CREATE INDEX "hangouts_cityId_status_startsAt_idx" ON "hangouts"("cityId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "hangout_joins_hangoutId_idx" ON "hangout_joins"("hangoutId");

-- CreateIndex
CREATE INDEX "hangout_joins_userId_idx" ON "hangout_joins"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "hangout_joins_hangoutId_userId_key" ON "hangout_joins"("hangoutId", "userId");

-- CreateIndex
CREATE INDEX "hangout_messages_hangoutId_createdAt_idx" ON "hangout_messages"("hangoutId", "createdAt");

-- CreateIndex
CREATE INDEX "hangout_references_toUserId_vibe_idx" ON "hangout_references"("toUserId", "vibe");

-- CreateIndex
CREATE INDEX "hangout_references_hangoutId_idx" ON "hangout_references"("hangoutId");

-- CreateIndex
CREATE UNIQUE INDEX "hangout_references_hangoutId_fromUserId_toUserId_key" ON "hangout_references"("hangoutId", "fromUserId", "toUserId");

-- CreateIndex
CREATE INDEX "availability_pulses_until_idx" ON "availability_pulses"("until");

-- CreateIndex
CREATE INDEX "availability_pulses_neighborhood_until_idx" ON "availability_pulses"("neighborhood", "until");

-- CreateIndex
CREATE INDEX "availability_pulses_userId_idx" ON "availability_pulses"("userId");

-- CreateIndex
CREATE INDEX "availability_pulses_cityId_until_idx" ON "availability_pulses"("cityId", "until");

-- CreateIndex
CREATE UNIQUE INDEX "pulse_waves_pulseId_userId_key" ON "pulse_waves"("pulseId", "userId");

-- CreateIndex
CREATE INDEX "visitor_announcements_status_endsOn_idx" ON "visitor_announcements"("status", "endsOn");

-- CreateIndex
CREATE INDEX "visitor_announcements_neighborhood_status_idx" ON "visitor_announcements"("neighborhood", "status");

-- CreateIndex
CREATE INDEX "visitor_announcements_cityId_status_endsOn_idx" ON "visitor_announcements"("cityId", "status", "endsOn");

-- CreateIndex
CREATE INDEX "saved_listings_userId_idx" ON "saved_listings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_placeId_key" ON "businesses"("placeId");

-- CreateIndex
CREATE INDEX "businesses_isApproved_isActive_idx" ON "businesses"("isApproved", "isActive");

-- CreateIndex
CREATE INDEX "businesses_category_idx" ON "businesses"("category");

-- CreateIndex
CREATE INDEX "businesses_neighborhood_idx" ON "businesses"("neighborhood");

-- CreateIndex
CREATE INDEX "businesses_cityId_isApproved_isActive_idx" ON "businesses"("cityId", "isApproved", "isActive");

-- CreateIndex
CREATE INDEX "businesses_cityId_verifiedAt_idx" ON "businesses"("cityId", "verifiedAt");

-- CreateIndex
CREATE INDEX "business_reviews_businessId_isHidden_idx" ON "business_reviews"("businessId", "isHidden");

-- CreateIndex
CREATE INDEX "business_reviews_authorId_idx" ON "business_reviews"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "business_reviews_businessId_authorId_key" ON "business_reviews"("businessId", "authorId");

-- CreateIndex
CREATE INDEX "business_reports_status_createdAt_idx" ON "business_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "business_reports_businessId_idx" ON "business_reports"("businessId");

-- CreateIndex
CREATE INDEX "business_saves_businessId_createdAt_idx" ON "business_saves"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "business_saves_userId_createdAt_idx" ON "business_saves"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_saves_userId_businessId_key" ON "business_saves"("userId", "businessId");

-- CreateIndex
CREATE INDEX "newsletters_sentAt_idx" ON "newsletters"("sentAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_email_logs_resendId_key" ON "newsletter_email_logs"("resendId");

-- CreateIndex
CREATE INDEX "newsletter_email_logs_newsletterId_idx" ON "newsletter_email_logs"("newsletterId");

-- CreateIndex
CREATE INDEX "business_claims_status_idx" ON "business_claims"("status");

-- CreateIndex
CREATE INDEX "business_claims_businessId_idx" ON "business_claims"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "business_claims_businessId_claimantId_key" ON "business_claims"("businessId", "claimantId");

-- CreateIndex
CREATE INDEX "member_saves_userId_idx" ON "member_saves"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pro_waitlist_email_key" ON "pro_waitlist"("email");

-- CreateIndex
CREATE INDEX "pro_waitlist_status_idx" ON "pro_waitlist"("status");

-- CreateIndex
CREATE INDEX "pro_waitlist_createdAt_idx" ON "pro_waitlist"("createdAt");

-- CreateIndex
CREATE INDEX "board_posts_status_createdAt_idx" ON "board_posts"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "board_posts_neighborhood_status_idx" ON "board_posts"("neighborhood", "status");

-- CreateIndex
CREATE INDEX "board_posts_type_status_idx" ON "board_posts"("type", "status");

-- CreateIndex
CREATE INDEX "board_posts_userId_idx" ON "board_posts"("userId");

-- CreateIndex
CREATE INDEX "board_posts_clubId_createdAt_idx" ON "board_posts"("clubId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "board_posts_eventId_createdAt_idx" ON "board_posts"("eventId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "board_posts_cityId_status_createdAt_idx" ON "board_posts"("cityId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "board_replies_postId_createdAt_idx" ON "board_replies"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "board_replies_userId_idx" ON "board_replies"("userId");

-- CreateIndex
CREATE INDEX "moving_sales_status_leavingOn_idx" ON "moving_sales"("status", "leavingOn");

-- CreateIndex
CREATE INDEX "moving_sales_cityId_status_leavingOn_idx" ON "moving_sales"("cityId", "status", "leavingOn");

-- CreateIndex
CREATE INDEX "moving_sale_items_saleId_idx" ON "moving_sale_items"("saleId");

-- CreateIndex
CREATE INDEX "guide_saves_cityId_slug_idx" ON "guide_saves"("cityId", "slug");

-- CreateIndex
CREATE INDEX "guide_saves_slug_recommended_idx" ON "guide_saves"("slug", "recommended");

-- CreateIndex
CREATE UNIQUE INDEX "guide_saves_userId_cityId_slug_key" ON "guide_saves"("userId", "cityId", "slug");

-- CreateIndex
CREATE INDEX "guide_tips_slug_cityId_createdAt_idx" ON "guide_tips"("slug", "cityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "guide_tip_likes_tipId_userId_key" ON "guide_tip_likes"("tipId", "userId");

-- CreateIndex
CREATE INDEX "event_saves_userId_createdAt_idx" ON "event_saves"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "event_saves_userId_eventId_key" ON "event_saves"("userId", "eventId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_viewedId_fkey" FOREIGN KEY ("viewedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_views" ADD CONSTRAINT "profile_views_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_blocks" ADD CONSTRAINT "member_blocks_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_blocks" ADD CONSTRAINT "member_blocks_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "event_surveys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_relationships" ADD CONSTRAINT "city_relationships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_relationships" ADD CONSTRAINT "city_relationships_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_entries" ADD CONSTRAINT "guide_entries_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_hosts" ADD CONSTRAINT "city_hosts_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_hosts" ADD CONSTRAINT "city_hosts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_spotlightUserId_fkey" FOREIGN KEY ("spotlightUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_photos" ADD CONSTRAINT "event_photos_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_photos" ADD CONSTRAINT "event_photos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_cohosts" ADD CONSTRAINT "event_cohosts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_cohosts" ADD CONSTRAINT "event_cohosts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_surveys" ADD CONSTRAINT "event_surveys_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_surveys" ADD CONSTRAINT "event_surveys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_predictions" ADD CONSTRAINT "cup_predictions_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "cup_fixtures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_predictions" ADD CONSTRAINT "cup_predictions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_bracket_picks" ADD CONSTRAINT "cup_bracket_picks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_sponsors" ADD CONSTRAINT "cup_sponsors_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_sponsors" ADD CONSTRAINT "cup_sponsors_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_prizes" ADD CONSTRAINT "cup_prizes_awardedToUserId_fkey" FOREIGN KEY ("awardedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_prizes" ADD CONSTRAINT "cup_prizes_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_prizes" ADD CONSTRAINT "cup_prizes_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "cup_sponsors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_prize_donations" ADD CONSTRAINT "cup_prize_donations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cup_prize_donations" ADD CONSTRAINT "cup_prize_donations_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_nps" ADD CONSTRAINT "member_nps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "tag_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_tag_map" ADD CONSTRAINT "interest_tag_map_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_recommendations" ADD CONSTRAINT "event_recommendations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_recommendations" ADD CONSTRAINT "event_recommendations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "no_show_cards" ADD CONSTRAINT "no_show_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "no_show_cards" ADD CONSTRAINT "no_show_cards_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "event_attendees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "no_show_cards" ADD CONSTRAINT "no_show_cards_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_applications" ADD CONSTRAINT "member_applications_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_applications" ADD CONSTRAINT "member_applications_targetCityId_fkey" FOREIGN KEY ("targetCityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_backup_codes" ADD CONSTRAINT "totp_backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_posts" ADD CONSTRAINT "club_posts_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_posts" ADD CONSTRAINT "club_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_post_likes" ADD CONSTRAINT "club_post_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "club_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_post_likes" ADD CONSTRAINT "club_post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_post_replies" ADD CONSTRAINT "club_post_replies_postId_fkey" FOREIGN KEY ("postId") REFERENCES "club_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_post_replies" ADD CONSTRAINT "club_post_replies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_polls" ADD CONSTRAINT "club_polls_postId_fkey" FOREIGN KEY ("postId") REFERENCES "club_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_poll_options" ADD CONSTRAINT "club_poll_options_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "club_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_poll_votes" ADD CONSTRAINT "club_poll_votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "club_poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_poll_votes" ADD CONSTRAINT "club_poll_votes_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "club_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_poll_votes" ADD CONSTRAINT "club_poll_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_resources" ADD CONSTRAINT "club_resources_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_photos" ADD CONSTRAINT "club_photos_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_photos" ADD CONSTRAINT "club_photos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_poll_options" ADD CONSTRAINT "community_poll_options_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "community_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_poll_votes" ADD CONSTRAINT "community_poll_votes_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "community_poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_poll_votes" ADD CONSTRAINT "community_poll_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_connections" ADD CONSTRAINT "member_connections_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_connections" ADD CONSTRAINT "member_connections_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "direct_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_toId_fkey" FOREIGN KEY ("toId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message_reactions" ADD CONSTRAINT "direct_message_reactions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "direct_message_reactions" ADD CONSTRAINT "direct_message_reactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighborhood_posts" ADD CONSTRAINT "neighborhood_posts_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighborhood_posts" ADD CONSTRAINT "neighborhood_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighborhood_post_likes" ADD CONSTRAINT "neighborhood_post_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "neighborhood_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighborhood_post_likes" ADD CONSTRAINT "neighborhood_post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighborhood_post_replies" ADD CONSTRAINT "neighborhood_post_replies_postId_fkey" FOREIGN KEY ("postId") REFERENCES "neighborhood_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighborhood_post_replies" ADD CONSTRAINT "neighborhood_post_replies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangouts" ADD CONSTRAINT "hangouts_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangouts" ADD CONSTRAINT "hangouts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangouts" ADD CONSTRAINT "hangouts_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangouts" ADD CONSTRAINT "hangouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangout_joins" ADD CONSTRAINT "hangout_joins_hangoutId_fkey" FOREIGN KEY ("hangoutId") REFERENCES "hangouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangout_joins" ADD CONSTRAINT "hangout_joins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangout_messages" ADD CONSTRAINT "hangout_messages_hangoutId_fkey" FOREIGN KEY ("hangoutId") REFERENCES "hangouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangout_messages" ADD CONSTRAINT "hangout_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangout_references" ADD CONSTRAINT "hangout_references_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangout_references" ADD CONSTRAINT "hangout_references_hangoutId_fkey" FOREIGN KEY ("hangoutId") REFERENCES "hangouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hangout_references" ADD CONSTRAINT "hangout_references_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_pulses" ADD CONSTRAINT "availability_pulses_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_pulses" ADD CONSTRAINT "availability_pulses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_waves" ADD CONSTRAINT "pulse_waves_pulseId_fkey" FOREIGN KEY ("pulseId") REFERENCES "availability_pulses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_announcements" ADD CONSTRAINT "visitor_announcements_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_announcements" ADD CONSTRAINT "visitor_announcements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reviews" ADD CONSTRAINT "business_reviews_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reviews" ADD CONSTRAINT "business_reviews_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reviews" ADD CONSTRAINT "business_reviews_ownerReplyById_fkey" FOREIGN KEY ("ownerReplyById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reports" ADD CONSTRAINT "business_reports_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reports" ADD CONSTRAINT "business_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reports" ADD CONSTRAINT "business_reports_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_saves" ADD CONSTRAINT "business_saves_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_saves" ADD CONSTRAINT "business_saves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletters" ADD CONSTRAINT "newsletters_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_email_logs" ADD CONSTRAINT "newsletter_email_logs_newsletterId_fkey" FOREIGN KEY ("newsletterId") REFERENCES "newsletters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_claimantId_fkey" FOREIGN KEY ("claimantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_claims" ADD CONSTRAINT "business_claims_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_saves" ADD CONSTRAINT "member_saves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_saves" ADD CONSTRAINT "member_saves_savedId_fkey" FOREIGN KEY ("savedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_replies" ADD CONSTRAINT "board_replies_postId_fkey" FOREIGN KEY ("postId") REFERENCES "board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_replies" ADD CONSTRAINT "board_replies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_replies" ADD CONSTRAINT "board_replies_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "board_replies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_interests" ADD CONSTRAINT "board_interests_postId_fkey" FOREIGN KEY ("postId") REFERENCES "board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_interests" ADD CONSTRAINT "board_interests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_saves" ADD CONSTRAINT "board_saves_postId_fkey" FOREIGN KEY ("postId") REFERENCES "board_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_saves" ADD CONSTRAINT "board_saves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moving_sales" ADD CONSTRAINT "moving_sales_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moving_sales" ADD CONSTRAINT "moving_sales_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moving_sale_items" ADD CONSTRAINT "moving_sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "moving_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_saves" ADD CONSTRAINT "guide_saves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_saves" ADD CONSTRAINT "guide_saves_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_tips" ADD CONSTRAINT "guide_tips_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_tip_likes" ADD CONSTRAINT "guide_tip_likes_tipId_fkey" FOREIGN KEY ("tipId") REFERENCES "guide_tips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guide_tip_likes" ADD CONSTRAINT "guide_tip_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_saves" ADD CONSTRAINT "event_saves_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_saves" ADD CONSTRAINT "event_saves_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

