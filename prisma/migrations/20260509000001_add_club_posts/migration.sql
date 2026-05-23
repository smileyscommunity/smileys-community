-- CreateTable
CREATE TABLE "club_posts" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_post_likes" (
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_post_likes_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateIndex
CREATE INDEX "club_posts_clubId_createdAt_idx" ON "club_posts"("clubId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "club_posts" ADD CONSTRAINT "club_posts_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_posts" ADD CONSTRAINT "club_posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_post_likes" ADD CONSTRAINT "club_post_likes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "club_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_post_likes" ADD CONSTRAINT "club_post_likes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
