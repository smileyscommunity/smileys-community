-- "I'm in" + comment thread for hangouts. Two small tables that hang off the
-- existing Hangout via cascade-delete so cancelling a hangout cleans them up.

CREATE TABLE "hangout_joins" (
  "id"        TEXT NOT NULL,
  "hangoutId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hangout_joins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hangout_joins_hangoutId_userId_key" ON "hangout_joins" ("hangoutId", "userId");
CREATE INDEX "hangout_joins_hangoutId_idx" ON "hangout_joins" ("hangoutId");
CREATE INDEX "hangout_joins_userId_idx"    ON "hangout_joins" ("userId");
ALTER TABLE "hangout_joins"
  ADD CONSTRAINT "hangout_joins_hangoutId_fkey" FOREIGN KEY ("hangoutId") REFERENCES "hangouts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "hangout_joins_userId_fkey"    FOREIGN KEY ("userId")    REFERENCES "users"("id")    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "hangout_messages" (
  "id"        TEXT NOT NULL,
  "hangoutId" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hangout_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hangout_messages_hangoutId_createdAt_idx" ON "hangout_messages" ("hangoutId", "createdAt");
ALTER TABLE "hangout_messages"
  ADD CONSTRAINT "hangout_messages_hangoutId_fkey" FOREIGN KEY ("hangoutId") REFERENCES "hangouts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "hangout_messages_userId_fkey"    FOREIGN KEY ("userId")    REFERENCES "users"("id")    ON DELETE CASCADE ON UPDATE CASCADE;
