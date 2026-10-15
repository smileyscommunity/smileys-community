-- Additive only: one new table, one nullable column. No backfill.
CREATE TABLE "post_comments" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "post_comments_postId_createdAt_idx" ON "post_comments"("postId", "createdAt");
CREATE INDEX "post_comments_userId_idx" ON "post_comments"("userId");
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" ADD COLUMN "postCommentId" TEXT;
