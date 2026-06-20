-- Post.kind splits the namespace between community-style articles
-- (/posts) and the Istanbul handbook (/handbook). Default 'community'
-- keeps existing rows in their current surface.

ALTER TABLE "posts" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'community';

CREATE INDEX "posts_kind_status_publishedAt_idx" ON "posts" ("kind", "status", "publishedAt");
