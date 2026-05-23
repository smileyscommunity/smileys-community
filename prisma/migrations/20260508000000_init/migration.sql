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
    "instagram" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phone" TEXT,
    "gender" TEXT,
    "profilePhoto" TEXT,
    "nationality" TEXT,
    "languages" TEXT[],
    "interests" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'approved',
    "membershipType" TEXT NOT NULL DEFAULT 'free',
    "lastActive" TIMESTAMP(3),
    "banReason" TEXT,
    "bannedAt" TIMESTAMP(3),
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "referralCode" TEXT,
    "referralCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "eventId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "screenshot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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

    CONSTRAINT "blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_memberships_pkey" PRIMARY KEY ("id")
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
    "whatsappUrl" TEXT,
    "instagramUrl" TEXT,
    "rules" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "coverImage" TEXT,
    "location" TEXT,
    "foundedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
    "totalSpots" INTEGER NOT NULL,
    "spotsLeft" INTEGER NOT NULL,
    "limitedSpots" BOOLEAN NOT NULL DEFAULT false,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "membersOnly" BOOLEAN NOT NULL DEFAULT false,
    "vibes" TEXT[],
    "whatsappUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "address" TEXT,
    "coverImage" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "meetingUrl" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "duration" INTEGER,
    "minAge" INTEGER,
    "maxAge" INTEGER,
    "language" TEXT,
    "difficulty" TEXT,
    "refundPolicy" TEXT,
    "registrationDeadline" TEXT,
    "endTime" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "genderBalance" BOOLEAN NOT NULL DEFAULT false,
    "maleQuota" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clubId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
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
    "status" TEXT NOT NULL DEFAULT 'approved',
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_attendees_pkey" PRIMARY KEY ("id")
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
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "method" TEXT NOT NULL DEFAULT 'card',
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transactionRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_applications" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "birthdate" TEXT,
    "gender" TEXT,
    "country" TEXT,
    "city" TEXT,
    "neighborhood" TEXT,
    "instagram" TEXT,
    "linkedin" TEXT,
    "profession" TEXT,
    "timeInCity" TEXT,
    "reasonHere" TEXT,
    "whyJoin" TEXT,
    "enjoyWith" TEXT,
    "goodCommunity" TEXT,
    "interests" TEXT[],
    "contribution" TEXT,
    "groupBehavior" TEXT,
    "removedFromCommunity" TEXT,
    "toxicBehavior" TEXT,
    "profilePhoto" TEXT,
    "assignedClubs" TEXT[],
    "suggestion" TEXT,
    "suggestedBy" TEXT,
    "bio" TEXT,
    "source" TEXT,
    "referredBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

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
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_messages" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateIndex
CREATE INDEX "reports_reportedId_idx" ON "reports"("reportedId");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "blacklist_email_key" ON "blacklist"("email");

-- CreateIndex
CREATE UNIQUE INDEX "club_memberships_userId_clubId_key" ON "club_memberships"("userId", "clubId");

-- CreateIndex
CREATE UNIQUE INDEX "clubs_slug_key" ON "clubs"("slug");

-- CreateIndex
CREATE INDEX "events_date_idx" ON "events"("date");

-- CreateIndex
CREATE INDEX "events_clubId_idx" ON "events"("clubId");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tag_groups_name_key" ON "tag_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "event_attendees_eventId_idx" ON "event_attendees"("eventId");

-- CreateIndex
CREATE INDEX "event_attendees_userId_idx" ON "event_attendees"("userId");

-- CreateIndex
CREATE INDEX "event_attendees_status_idx" ON "event_attendees"("status");

-- CreateIndex
CREATE UNIQUE INDEX "event_attendees_userId_eventId_key" ON "event_attendees"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_eventId_key" ON "reviews"("userId", "eventId");

-- CreateIndex
CREATE INDEX "payments_userId_idx" ON "payments"("userId");

-- CreateIndex
CREATE INDEX "payments_eventId_idx" ON "payments"("eventId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "event_messages_eventId_idx" ON "event_messages"("eventId");

-- CreateIndex
CREATE INDEX "event_messages_userId_idx" ON "event_messages"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_key" ON "email_verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

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

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "tag_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_applications" ADD CONSTRAINT "member_applications_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_messages" ADD CONSTRAINT "event_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

