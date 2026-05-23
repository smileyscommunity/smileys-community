CREATE TABLE "community_polls" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "community_polls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_poll_options" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "community_poll_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_poll_votes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "community_poll_votes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "community_poll_options"
    ADD CONSTRAINT "community_poll_options_pollId_fkey"
    FOREIGN KEY ("pollId") REFERENCES "community_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_poll_votes"
    ADD CONSTRAINT "community_poll_votes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "community_poll_votes"
    ADD CONSTRAINT "community_poll_votes_optionId_fkey"
    FOREIGN KEY ("optionId") REFERENCES "community_poll_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "community_poll_votes_userId_pollId_key" ON "community_poll_votes"("userId", "pollId");
