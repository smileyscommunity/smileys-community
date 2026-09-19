-- Serving a DM photo checks that the requester is in that conversation,
-- which looks the message up by its image URL.
CREATE INDEX "direct_messages_imageUrl_idx" ON "direct_messages"("imageUrl");
