-- Newsletter log. Each row records one blast to the opted-in member list.
-- recipientCount is snapshotted at send time so the number stays meaningful
-- even if members unsubscribe or are deleted later.

CREATE TABLE "newsletters" (
    "id"             TEXT         NOT NULL,
    "subject"        TEXT         NOT NULL,
    "bodyHtml"       TEXT         NOT NULL,
    "recipientCount" INTEGER      NOT NULL,
    "sentById"       TEXT         NOT NULL,
    "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "newsletters_sentAt_idx" ON "newsletters" ("sentAt" DESC);

ALTER TABLE "newsletters"
    ADD CONSTRAINT "newsletters_sentById_fkey"
    FOREIGN KEY ("sentById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
