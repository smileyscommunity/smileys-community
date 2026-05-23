-- Pinned posts
ALTER TABLE "club_posts" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "club_posts" ADD COLUMN "pinnedAt"  TIMESTAMP(3);

-- Emoji reactions (extend existing likes table)
ALTER TABLE "club_post_likes" ADD COLUMN "emoji" TEXT NOT NULL DEFAULT '❤️';

-- Polls
CREATE TABLE "club_polls" (
  "id"       TEXT NOT NULL,
  "postId"   TEXT NOT NULL,
  "question" TEXT NOT NULL,
  CONSTRAINT "club_polls_pkey"       PRIMARY KEY ("id"),
  CONSTRAINT "club_polls_postId_key" UNIQUE      ("postId")
);
ALTER TABLE "club_polls"
  ADD CONSTRAINT "club_polls_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "club_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "club_poll_options" (
  "id"     TEXT    NOT NULL,
  "pollId" TEXT    NOT NULL,
  "text"   TEXT    NOT NULL,
  "order"  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "club_poll_options_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "club_poll_options"
  ADD CONSTRAINT "club_poll_options_pollId_fkey"
  FOREIGN KEY ("pollId") REFERENCES "club_polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "club_poll_options_pollId_idx" ON "club_poll_options"("pollId");

CREATE TABLE "club_poll_votes" (
  "id"        TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "pollId"    TEXT         NOT NULL,
  "optionId"  TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "club_poll_votes_pkey"            PRIMARY KEY ("id"),
  CONSTRAINT "club_poll_votes_userId_pollId_key" UNIQUE ("userId", "pollId")
);
ALTER TABLE "club_poll_votes"
  ADD CONSTRAINT "club_poll_votes_userId_fkey"
  FOREIGN KEY ("userId")   REFERENCES "users"("id")              ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "club_poll_votes"
  ADD CONSTRAINT "club_poll_votes_pollId_fkey"
  FOREIGN KEY ("pollId")   REFERENCES "club_polls"("id")         ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "club_poll_votes"
  ADD CONSTRAINT "club_poll_votes_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "club_poll_options"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "club_poll_votes_optionId_idx" ON "club_poll_votes"("optionId");
