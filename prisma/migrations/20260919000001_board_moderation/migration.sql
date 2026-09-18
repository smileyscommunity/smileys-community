-- Board moderation: a reply can be reported and taken down, and an edited
-- post says so.
ALTER TABLE "reports" ADD COLUMN "boardReplyId" TEXT;
CREATE INDEX "reports_boardReplyId_idx" ON "reports"("boardReplyId");
ALTER TABLE "board_replies" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "board_posts" ADD COLUMN "editedAt" TIMESTAMP(3);
