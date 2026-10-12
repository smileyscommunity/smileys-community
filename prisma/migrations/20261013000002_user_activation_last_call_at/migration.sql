-- When a never-activated member was sent the one-time "last call" activation
-- email (admin Retention > Not activated). Additive: one nullable column,
-- every existing row reads NULL ("not sent"), nothing else changes.
--
-- Rollback (loses only the record of who got the email; anyone who did could
-- then be sent it again):
--   ALTER TABLE "users" DROP COLUMN "activationLastCallAt";
ALTER TABLE "users" ADD COLUMN "activationLastCallAt" TIMESTAMP(3);
