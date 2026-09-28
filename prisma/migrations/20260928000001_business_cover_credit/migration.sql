-- Credit for a directory cover that is someone else's photo.
--
-- Some venues' only good photos are on Wikimedia Commons under CC BY or
-- CC BY-SA, which may be used only with the author and licence named wherever
-- the photo appears. Listings had no place to say that, so those photos could
-- not be used at all. coverCredit is the line shown with the photo ("Asibala ·
-- CC BY-SA 4.0"); coverCreditUrl links it to the source page. Nullable and
-- additive: no existing row changes, and a cover with no credit renders as
-- before.
ALTER TABLE "businesses" ADD COLUMN "coverCredit" TEXT;
ALTER TABLE "businesses" ADD COLUMN "coverCreditUrl" TEXT;
