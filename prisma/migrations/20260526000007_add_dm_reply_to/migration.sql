-- Reply-to-message (quote bubble) for direct messages. Self-referencing FK
-- with SET NULL on delete so a reply doesn't vanish when its parent is
-- deleted (the quote chip just disappears).

ALTER TABLE "direct_messages" ADD COLUMN "replyToId" TEXT;
CREATE INDEX "direct_messages_replyToId_idx" ON "direct_messages" ("replyToId");
ALTER TABLE "direct_messages"
  ADD CONSTRAINT "direct_messages_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "direct_messages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
