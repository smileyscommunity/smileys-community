-- When a payment became paid.
--
-- Revenue and the payments date filter were dated by "createdAt" — when the
-- payment row was written, usually at RSVP. An RSVP made 40 days ago and paid
-- today never appeared in "Revenue (30 days)", and a bank reconciliation
-- filtered by date picked the wrong rows. The admin payments page and the
-- participants checklist now stamp this when they mark a payment paid.
--
-- Additive and nullable: code that doesn't know the column is unaffected.
ALTER TABLE "payments" ADD COLUMN "paidAt" TIMESTAMP(3);

-- Backfill the rows already paid: the latest time the payment log recorded
-- a change TO paid, else the row's own creation time (a payment created
-- straight as paid, or one paid before the log existed).
UPDATE "payments" p
SET "paidAt" = COALESCE(
  (SELECT MAX(l."createdAt") FROM "payment_logs" l WHERE l."paymentId" = p.id AND l."toStatus" = 'paid'),
  p."createdAt"
)
WHERE p.status = 'paid' AND p."paidAt" IS NULL;

CREATE INDEX "payments_paidAt_idx" ON "payments"("paidAt");
