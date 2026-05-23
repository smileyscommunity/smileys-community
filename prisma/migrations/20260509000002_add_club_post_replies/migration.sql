CREATE TABLE "club_post_replies" (
  "id"        TEXT         NOT NULL,
  "postId"    TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "content"   TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "club_post_replies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "club_post_replies"
  ADD CONSTRAINT "club_post_replies_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "club_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "club_post_replies"
  ADD CONSTRAINT "club_post_replies_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "club_post_replies_postId_createdAt_idx"
  ON "club_post_replies"("postId", "createdAt");
