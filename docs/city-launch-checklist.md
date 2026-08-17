# Launching a city

Written the night Bodrum became the second live city (2026-08-17), from what
that launch actually needed and what it broke. Istanbul is the default city, so
anything not done here tends to fall back to Istanbul rather than fail — which
is why these steps are a list rather than a thing you'd notice.

The order matters: **everything under "Before `live`" should be done while the
city is still `preparing`.** A `coming_soon` or `preparing` city renders a
holding page, so nothing below is visible to members until you flip it. Once
it's `live`, every gap is public.

---

## Before `live`

### 1. The city row
`name`, `slug`, `country`, `timezone`, `tagline`, `description`, `heroImage`.

- **`timezone` is load-bearing**, not decoration. It decides "today" for that
  city's events, visit windows and neighborhood counts. It's non-null on the
  model, so it can't be forgotten — but it can be wrong.
- **`heroImage`** is the city's share preview. Without one, a shared link falls
  back to a cover shot of Istanbul.

### 2. Neighborhoods — *this one is a launch blocker*
Every neighborhood picker in the product reads this table: profile, apply,
board post, hangout, directory submit. A city with no rows gets an **empty
dropdown** in all of them, and `safeNeighborhoodFor` silently nulls anything
submitted — the field looks saved and comes back blank.

Copy `scripts/seed-neighborhoods-bodrum.ts`. It's idempotent and takes
`DRY_RUN=1`. Four traps it exists because of:

- **Check what's already there first.** Bodrum had 8 rows seeded under
  different names (`Bodrum Merkez`, not `Bodrum Town`; `Türkbükü`, not
  `Göltürkbükü`). Seeding blind puts two picker entries on one place. The live
  names win — member rows may already reference them.
- **`sortOrder` must append**, not come from the new list's index, or new rows
  claim numbers the existing ones hold and the picker order scrambles.
- **Emoji must be unique within the city.** It's the row's visual handle, so a
  repeat reads as a duplicate entry. Two seeding passes collided on four.
- **Never write coordinates from memory.** Three of seven were 4–6 km out.
  Verify against Nominatim — no key needed, and it's the same source
  `app/api/admin/geocode/route.ts` uses. Trust `place=village` / `place=suburb`
  hits; a `highway=` hit is a *street of the same name*, and
  `boundary=administrative` is a *mahalle* centroid that can legitimately sit
  ~2 km from the settlement.

`area` is per-city free text. Istanbul's `Central / European / Asian / Coastal
/ Emerging / Islands` describes a city split by a strait — use the vocabulary
that fits (Bodrum groups by coast). Don't reuse Istanbul's words unless they're
true, since some copy still keys off them.

### 3. Clubs and hosts
`PATCH /api/admin/cities/[id]` **refuses to go live** without at least one
active club and one host. This is the only step the system enforces for you.

### 4. Editorial (optional, but visible)
`data/neighborhoods/<city-slug>/<slug>.json` gives a neighborhood page its
tagline and places. Without it the page falls back to a generated paragraph
built from vibe, area, cost and nearest neighbors — true, but thin. Istanbul
has 89 hand-authored guides behind its 103 neighborhoods.

---

## After `live` — check these by eye

Each of these was a real bug found on Bodrum's launch night, all now fixed. If
one reappears, it's a regression, not a new city's setup:

- **The city page hero** names the city, and the **footer band** names the same
  city (it used to follow the session, so a visitor from search got an Istanbul
  footer under a Bodrum hero).
- **A neighborhood page opened in a private window** — not just while logged
  in. `/neighborhoods/<slug>` used to 404 for anyone without that city's
  cookie, which is every crawler and every shared link.
- **`/neighborhoods` shared from the address bar.** A non-default city should
  redirect to `?city=<slug>`, so the URL you copy names the city.
- **The board heading** reads "<City> Board", not Istanbul's.
- **A shared link previewed in WhatsApp.** The title, description and image
  should all name the city.

---

## Known gaps a third city will hit

Honest list, still open as of 2026-08-17:

- **`/visiting`** is Istanbul copy end to end and hard-scoped to the default
  city. A second city's visitors are unreachable from it.
- **`/why`, `/about`, `/advertise`** carry Istanbul copy and OG metadata.
- **41 `Europe/Istanbul` literals.** Harmless while every city is in Türkiye;
  the first city outside it breaks time-of-day maths in ~29 files.
- **`/board` and `/marketplace` share cards** can't name a city for a crawler.
  Layouts get no `searchParams` and both index pages are client components, so
  there's no city in the URL to read. Needs a city-bearing route.
- **`tests/cityHardcoding.test.ts`** ratchets the count of hardcoded city names
  (242 across 85 files at launch). It stops new ones; it doesn't clean up the
  existing ones. When a file reaches zero, delete its line.
