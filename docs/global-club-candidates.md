# Global-club candidates — owner classification needed

**Why this list exists:** the multi-city brief (§6) wants `Club.cityId` to be
nullable, where `NULL` means *global* — a club that appears in every city's
club list (Cultures of the World, Language clubs, online/thematic clubs).
Per the brief, existing clubs must not be blanket-stamped: someone who knows
the community has to say which clubs are actually global. That's this
document. The schema migration happens only after it's marked up.

**What marking a club global means in practice:** it shows in the Clubs grid
of *every* live city (İzmir and Bodrum members see it alongside their local
clubs), its feed stops being Istanbul-scoped, and its events keep their own
per-event city. If in doubt, leave a club local — promoting later is one
`UPDATE`; demoting a club people joined as global is a product decision.

Mark with `[g]` = global, leave `[ ]` = stays Istanbul-local.
Data: production, active clubs only, 2026-08-16.

## Strong candidates (the brief's own examples)

### Culture (identity clubs — "Cultures of the World")

- [ ] Middle Eastern (225) · [ ] Western European (115) · [ ] North African (112)
- [ ] Iranian (94) · [ ] North American (89) · [ ] Eastern European (55)
- [ ] South Asian (47) · [ ] Mediterranean (45) · [ ] Latin American (36)
- [ ] Central Asian (29) · [ ] West African (23) · [ ] Balkan (22)
- [ ] Southeast Asian (19) · [ ] East African (16) · [ ] Southern African (12)
- [ ] East Asian (10) · [ ] Australian & Pacific (9) · [ ] Scandinavian (6)

*(Architecture (64) is categorized "Culture" in the DB but is an activity
club, not an identity club — listed under judgement calls below.)*

### Language

- [ ] English (100) · [ ] French (85) · [ ] Turkish (82) · [ ] Arabic (63)
- [ ] Spanish (41) · [ ] Persian (35) · [ ] Russian (29) · [ ] Italian (28)
- [ ] German (27) · [ ] Greek (11) · [ ] Chinese (8) · [ ] Japanese (6)
- [ ] Korean (4) · [ ] Portuguese (3)

## Judgement calls — could go either way

- [ ] Architecture (64, Culture) — activity club; meets at buildings, which are in a city
- [ ] Expat Life (53, Networking) · [ ] Digital Nomads (40) · [ ] Remote Workers (31) — themes are global, meetups are local
- [ ] Solo Travel (36, Travel) · [ ] City Breaks (75) · [ ] Weekend Getaways (50) · [ ] Road Trips (35) — travel starts from a city but crosses them
- [ ] Women (99, Exclusive) · [ ] Singles (35) · [ ] Americans (33) · [ ] LGBTQ+ (15) · [ ] Men (13) · [ ] Couples (11) · [ ] Parents (5) · [ ] Family (2) — identity-based; would every city want one shared club or its own chapter?

## Clearly local (no action — listed for completeness)

Everything venue- and activity-based stays city-scoped: all Sports (16),
Outdoor (12), Food & Drinks (15), Nightlife (4), Wellness (9), Creative (11),
Business (10), Social (18 incl. the per-city "Social İstanbul/İzmir/Bodrum"
and "Coffee & Conversation" clubs), Volunteering (4), Newcomers per city (2),
Coworking (252), International Students (50), Newcomers (15), Tech &
Developers (25).

## When this is marked up

Implementation is ready to go and small: a migration making `Club.cityId`
nullable (+ rollback), an `UPDATE … SET "cityId" = NULL` for the marked
clubs, and `OR cityId IS NULL` in the club read paths (`getClubs`,
city-page club strip, club counts). Estimated one sitting; the audit
(§3.3) has the details.
