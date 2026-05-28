-- DM upgrades for WhatsApp-feel parity:
--   imageUrl on direct_messages — image attachments
--   direct_message_reactions   — one emoji per user per message

ALTER TABLE "direct_messages" ADD COLUMN "imageUrl" TEXT;

CREATE TABLE "direct_message_reactions" (
  "id"        TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "emoji"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "direct_message_reactions_messageId_userId_key"
  ON "direct_message_reactions" ("messageId", "userId");
CREATE INDEX "direct_message_reactions_messageId_idx"
  ON "direct_message_reactions" ("messageId");

ALTER TABLE "direct_message_reactions"
  ADD CONSTRAINT "direct_message_reactions_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "direct_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "direct_message_reactions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
