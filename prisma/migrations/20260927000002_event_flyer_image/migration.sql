-- An event's flyer — the designed poster, shown whole on the event page.
--
-- The only image an event had was its cover, which every surface crops to a
-- wide banner (cards, the event page header). A portrait flyer put there lost
-- its top and bottom — usually the date, place and price printed on it — so
-- hosts had nowhere to put one. The cover stays the photo on cards; this is
-- the flyer, uncropped. Nullable and additive: no existing row changes.
ALTER TABLE "events" ADD COLUMN "flyerImage" TEXT;
