-- Additive only: one nullable column + one new table. No backfill.
ALTER TABLE "post_comments" ADD COLUMN "editedAt" TIMESTAMP(3);
CREATE TABLE "post_comment_likes" (
  "commentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "post_comment_likes_pkey" PRIMARY KEY ("commentId","userId")
);
CREATE INDEX "post_comment_likes_commentId_idx" ON "post_comment_likes"("commentId");
ALTER TABLE "post_comment_likes" ADD CONSTRAINT "post_comment_likes_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "post_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "post_comment_likes" ADD CONSTRAINT "post_comment_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
