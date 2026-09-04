# City launch checklist

Written the night Bodrum became the second live city (2026-08-17); rewritten
after İzmir (2026-08-28) and Antalya (2026-08-31) — Antalya took one
afternoon end to end. Istanbul is the default city, so anything not done here
tends to fall back to Istanbul rather than fail, which is why these steps are
a list rather than a thing you'd notice.

The city's card in `/admin/cities` shows a **readiness meter** ("2/3 to
launch") and a **launch-inventory row** (members / upcoming / guide /
handbook) — amber numbers are the to-do list. Everything below should be done
while the city is still `preparing`/`coming_soon` (holding page); once it's
`live`, every gap is public.

## 0. Sequencing rules learned the hard way

- **Seed clubs BEFORE approving any member.** Both enrolment moments
  (application review, onboarding) pass silently when the club shelf is
  empty, and nothing retro-enrols — Antalya's first two members sat club-less
  for two weeks. If members already exist, re-run the register-route enrol
  pattern (membership upsert + memberCount increment) after seeding.
- **Flip status via the ADMIN PANEL, not SQL.** The API's live-flip runs
  `notifyCityLaunch` (interest-list emails + bells, `notifiedAt`-deduped).
  Both weekend launches flipped via SQL and orphaned 3 waiting people until
  a manual repair.
- The admin **default club** setting applies only to default-city approvals;
  other cities' approvals auto-resolve to their own `social-<slug>` club
  (server-side backstop since 2026-08-31).

## 1. The city row

`name`, `slug`, `country`, `timezone`, `currency`, `tagline`, `description`,
`heroImage` — all in the panel.

- **`timezone` is load-bearing**, not decoration: it decides "today" for the
  city's events, visit windows and neighborhood counts.
- **`heroImage`** is the city's share preview; without one a shared link
  falls back to a shared photo.

## 2. Neighborhoods — *the hard launch blocker*

Every picker in the product reads this table (profile, apply, board,
hangout, directory submit); a city with no rows gets empty dropdowns and
`safeNeighborhoodFor` silently nulls submissions. ~14–16 entries: the city's
districts plus the escape towns people actually go to. Seed via the panel's
paste box or `scripts/seed-neighborhoods.ts <slug> <file.json>` (DRY_RUN
first; shape in `scripts/neighborhoods.example.json`, prior lists in
`scripts/*-neighborhoods.json`). Enrich (emoji/vibe/area/cost/pins) later in
/admin/neighborhoods with the city selected. Traps the tooling exists for:

- **Check what's already there first** — live names win; member rows may
  reference them (Bodrum: `Bodrum Merkez` vs `Bodrum Town`).
- **`sortOrder` appends** after the existing max, never from list index.
- **Emoji unique within the city** — it's the row's visual handle.
- **Never write coordinates from memory** (three of Bodrum's seven were
  4–6 km out). Verify against Nominatim: trust `place=village`/`suburb`;
  a `highway=` hit is a street, `boundary=administrative` a mahalle centroid.
- **`area` is per-city free text** — use vocabulary that's true for this
  city (Bodrum groups by coast; İzmir by bay/peninsula), never Istanbul's.
- Resort strips can get map pins without guide entries — a dot isn't an
  endorsement.

## 3. Clubs and hosts

"Launch starter clubs" on the city card (or `scripts/launch-city-clubs.ts`):
full template lineup, **Bodrum shape** — social flagship + newcomers +
coffee open, the rest dormant until a host volunteers (activate in
/admin/clubs). Assign the city host in the panel (Nate G. is standing
default host everywhere; add the local consul when found — since 2026-08-31
grants are real: hosts run their own events through /host, review-queued).
The go-live gate enforces ≥1 active club + ≥1 host + ≥1 neighborhood.

**Then attach that host to the clubs themselves — the gate does not check
this.** "Host" means two separate things: a `city_hosts` grant (city-wide
authority) and a `club_memberships` row with `role='host'` (who runs this
club). The panel gives the first; only the second lets anyone create an
event in a club, and `classifyCityMaturity` counts hosted clubs, so a city
with zero of them is stuck in the seeding stage no matter how many members
it gains. Antalya launched, ran for two days with ten members and three
hosted-by-nobody clubs, and could not have held an event.

```
CITY=<slug> HOST_EMAIL=nate@smileyscommunity.com \
  npx tsx --env-file=.env --env-file=.env.local scripts/ensure-city-host.ts
… APPLY=1 …   # writes; idempotent, safe to re-run
```

Dry run prints every club it would touch. It promotes an existing membership
in place and moves `memberCount` only when it creates a row — that column
counts approved memberships *including* hosts. Adding a second host later
(the local lead) is the same command with their email; it never removes
anyone.

## 4. Guide (~12–15 experiences)

Draft with the community-growth agent (İzmir/Antalya prompts are the
template; `docs/*-guide-entries.draft.json` show the bar). New cities use
the GENERIC vocabulary until a custom list earns its deploy — **if
lib/guide.ts later gains a city list, remap the existing entries in the same
change** (`scripts/scan-guide-vocabulary.ts` catches drift). Seed as drafts
(`scripts/seed-city-guide.ts`), fact-check flagged items against official
sources (this killed a fatal-accident cable car and a suspended tram from
Antalya's set), then publish with `scripts/publish-city-guide.ts <slug>`
(DRY_RUN first; every draft in the city, or a comma list of slugs; refuses a
draft with an empty Take, same rule as the panel). `lastReviewedAt` stays
null until a human on the ground checks. **Then fact-check the published
text adversarially** — a second, independent pass against primary sources
found eleven wrong facts in Ankara's fifteen entries that the drafting pass
had "verified" (a festival date from the previous year, a dish described
backwards, a direction of travel wrong). Fix in the draft file and carry the
fixes to the rows with `scripts/update-city-guide.ts` (DRY_RUN first; never
touches status, order, photo or lastReviewedAt); articles the same way with
`scripts/update-handbook-article.ts`.

## 5. Handbook + neighborhood editorial

The four national articles apply automatically. Write the transport-card
article (İzmirim Kart / Antalyakart pattern: official municipality sources,
fares deliberately absent, ⚠ VERIFY resolved or hedged) and publish via
`scripts/publish-handbook-article.ts <content.json>`. City-local gaps
(renting, healthcare, daily life, family) wait for local knowledge — the
host's job. Neighborhood guides (`data/neighborhoods/<city-slug>/<slug>.json`,
edited in /admin/neighborhoods) are optional enrichment; pages fall back to a
generated paragraph.

## 5b. Directory seed (optional, needs a Places key)

A new city launches with zero venues, and that is the emptiest column on the
city page. `scripts/seed-city-places.ts` fills it from Google Places, anchored
to the neighborhood coordinates seeded in §2 — so §2 really is the blocker for
this too.

```
GOOGLE_PLACES_API_KEY=… CITY=<slug> npx tsx --env-file=.env --env-file=.env.local \
  scripts/seed-city-places.ts          # dry run: prints, writes nothing
… APPLY=1 …                            # write
```

Facts (name, address, coords, phone, hours) are mirrored from Places and never
invented; `placeId` is stored as the durable re-fetch key, `verifiedAt` stamped
at fetch. Rows land **unapproved** with a placeholder description — someone
writes the real line and approves in /admin/directory, same queue as member
submissions. Defaults keep ≤4 per neighborhood above 4.2★/40 reviews: a curated
directory, not a scrape. Re-runs skip any `placeId` already stored.

Not yet built: the scheduled re-verification that re-hits Places and sets
`closedAt`. Until it exists, `verifiedAt` only ever means "as of the seed".

## 6. Go live

Gate green → flip **in the panel** (rule 0). Founding-stage framing,
founding-member dashboard, and honest homepage counts (maturity-derived — a
2-member city never inflates "live in N cities") engage automatically.

## 7. First people

- Personal founding-member email to anyone waiting (Antalya template,
  2026-08-31; Resend with replyTo → owner).
- Stage the city's digest-spotlight card in the CMS `digestSpotlight` array
  (`from`/`until` windows queue behind the current one).
- Watch replies — whoever names the first gathering is your host candidate.

## After `live` — check by eye

Each was a real bug on a launch night; a reappearance is a regression:

- City page hero and footer band name the SAME city.
- A neighborhood page opens in a private window (no cookie), and
  `/neighborhoods` shared from the address bar carries `?city=<slug>`.
- Board heading reads "<City> Board"; hangouts asks "Who's around in
  <City>?".
- A shared link previews in WhatsApp with the city's own title/image.
- The new members appear in the city's Social club (rule 0).

## Known gaps at every launch (deliberate, revisit on schedule)

- A launched city has **no venues** in the directory until someone fills it;
  `scripts/seed-city-places.ts` (§5b) needs a Google Places key that does not
  exist yet, and the re-verification cron that would set `closedAt` is unbuilt.
- **Zero events** is the real cold-start problem, and no gate catches it: a
  city can sit live, badged Founding, with members and no reason to show up.
  Antalya reached ten members with none. Members follow events, not the
  reverse — the first small dinner or hangout is the launch step nothing in
  this checklist can do for you.
- Non-default cities receive **no weekly digest** (decide at ~50 members).
- City-scoped newsletters can't be **scheduled** (Newsletter.cityId
  migration pending); send-now works.
- Handbook Quick Reference + "Start here" shelf are default-city-only.
- Community polls are network-wide (no city dimension).
- First **non-Turkish** city is a named project. Two of its three blockers
  are now cleared, both on 2026-09-04:
  - DONE: pinned timezones. The `tests/timezoneHardcoding.test.ts` baseline
    is at zero — every site asks its city through `lib/cityTime` /
    `getCityTz`, and `tests/cityTimeDst.test.ts` pins the behaviour on
    Athens and New York, both sides of the DST jump (no Turkish city has
    observed DST since 2016, so this had never been exercised). The Cup is
    the one named exception: it runs on `CUP_TZ` (the founding city) because
    it was a network-wide game, not a city event.
  - DONE: handbook country scoping — `Post.country` + `lib/postScope`;
    national articles show only in their country, and the panel's "Applies
    in" picker / the publish script's `country` field set it.
  - DONE: currency and country copy. Money is spelled once
    (`DEFAULT_CURRENCY`, `currencySymbol`, `formatMoney` in lib/data.ts) and
    every admin figure, price label and placeholder asks the city's currency
    via `useCurrentCity()`; events are created in their club's city currency;
    phone placeholders use `phonePlaceholder(country)`; the geocoder anchors
    on the administered city, not "Istanbul, Turkey"; JSON-LD names the real
    country. `tests/countryHardcoding.test.ts` holds it at zero (lira sign,
    'TRY', '+90') and baselines the country NAME per file — the Turkish-male
    quota is a real feature and stays. Still true by design: the guide's
    `cost` convention is the city's own symbol doubled ("€€" in Athens).

  What a non-Turkish city still needs that no code can give it: its own
  national handbook articles (residence permit, bank account, SIM) marked
  "<country> only", a local host for the first event, and a currency the
  panel's Settings whitelist knows (₺ $ € £ ₾ лв today).
