-- When an admin last sent a never-activated member a fresh activation link on
-- WhatsApp (admin Retention > Not activated). Additive: one nullable column,
-- every existing row reads NULL ("never messaged"), nothing else changes.
--
-- Rollback (loses only the record of who was messaged when):
--   ALTER TABLE "users" DROP COLUMN "whatsappNudgedAt";
ALTER TABLE "users" ADD COLUMN "whatsappNudgedAt" TIMESTAMP(3);
