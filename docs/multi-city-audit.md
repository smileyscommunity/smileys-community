# Multi-city architecture — Pass A audit

**Status: audit only.** No schema, migration, route or component changes were made in this pass.

**Headline: most of the Must Have scope in §38 already exists.** The multi-city
architecture was built and deployed on 2026-08-15/16. Three cities are live
(Istanbul, Izmir, Bodrum) and three are coming soon (Ankara, Antalya, Bursa).
This document records what exists, where it differs from the brief, and what a
Pass B would actually consist of — which is much smaller than the brief assumes.

Read §3 (Deltas) first. It is the part that needs decisions.

---

## 1. What already exists

### City entity — `prisma/schema.prisma`

```
City: id, name, slug (unique), country, timezone, currency, defaultLang,
      status, tagline?, description?, heroImage?, createdAt, consulUserId?
```

Six rows today. `status` drives every public surface.

### City-scoped entities

`cityId` is **required** on: Event, Club, Business, Listing, Hangout,
Neighborhood, BoardPost, MovingSale, VisitorAnnouncement, AvailabilityPulse,
Partner, NeighborhoodPost, GuideEntry.

`Post.cityId` is **nullable by design** — null means global content (national
handbook articles shown in every city).

### Membership

Three separate structures, not one:

| Concept | Where it lives |
|---|---|
| Home city | `User.cityId` — required, exactly one, scopes every feed |
| Additional cities joined | `CityMembership (userId, cityId, joinedAt)`, unique on the pair |
| Interest in a pre-launch city | `CityInterest (userId, cityId, createdAt)`, unique on the pair |
| Visiting | `VisitorAnnouncement.cityId` — the destination city, with dates |
| City host grants | `CityHost (userId, cityId, status, grantedAt, revokedAt)` |

### Routes

- `/cities` — database-driven index, live cities then "on the way"
- `/<citySlug>` — one reusable page component for every city
  (`app/[city]/page.tsx`). Nothing in it names a city.
- Non-live cities get a holding page rather than an empty shopfront.

### Behaviour already implemented

- **Scoping chokepoint**: `resolveCityId(session)` in `lib/city.ts`, used by ~25
  call sites. A cookie-based viewing city overrides it; authorization does *not*
  read it (see §4).
- **City switcher**: `components/CitySwitcher.tsx`, hidden below two live cities.
- **One-click join** for approved members: `POST /api/me/cities`. Refuses
  non-live cities and unapproved members; idempotent.
- **Interest**: `POST /api/me/city-interest` for pre-launch cities.
- **Admin**: create city (`POST /api/admin/cities`), edit status/tagline/
  description/hero (`PATCH /api/admin/cities/[id]`). Going live is refused while
  a city has no active clubs or no hosts.
- **SEO**: per-city `generateMetadata`, canonical, and the city's own photo as
  its OG image at `?w=1200`.
- **Istanbul backfill**: completed via `scripts/backfill-city-ids.sql`
  (add column NOT NULL DEFAULT istanbul, then `db push` drops the default).

---

## 2. Section-by-section status against the brief

| § | Item | Status |
|---|---|---|
| 4 | City data model | **Exists**, field deltas in §3.4 |
| 5 | City relationships | **Partial** — different shape, see §3.1 |
| 6 | City IDs drive the app | **Exists**, except Club nullability (§3.3) |
| 7–9 | Cities landing page, cards, status UX | **Exists** |
| 10–11 | Reusable city page | **Exists** at `/<slug>`, not `/cities/<slug>` (§3.5) |
| 12–13 | Events / clubs on city page | **Exists**, city-filtered |
| 14–19 | Members, hosts, hangouts, guide, businesses, neighborhoods | **Exists** |
| 20 | City switcher | **Exists** |
| 21 | Home city | **Exists** as `User.cityId`; no member-facing picker (§3.2) |
| 22 | Visiting | **Exists** — `VisitorAnnouncement.cityId` + destination picker |
| 23 | Join / interest | **Exists**, application flow untouched |
| 24–26 | Launch score, admin dashboard, city lead | Not built (Phase 2, per brief) |
| 27 | Istanbul migration | **Done** |
| 28 | Existing URLs | Preserved; no redirects needed so far |
| 29 | SEO | **Exists** |
| 30 | Empty states | **Exists** for cities; per-section states are thinner |
| 32 | Responsive | **Exists**; footer/nav reworked for mobile today |
| 35 | Data integrity | Mostly DB-level; gaps in §3.1 |
| 36 | Analytics | **Not done** — no city events emitted (§3.6) |
| 37 | First Table | **Does not exist** (§3.7) |

---

## 3. Deltas — the decisions this pass needs

### 3.1 Membership shape: `UserCity` vs what exists

The brief specifies one table with `relationship_type ∈ {home, member, visiting,
interested}`, a partial unique index enforcing one home per user, and no
`is_primary` flag.

What exists splits that across `User.cityId` (home), `CityMembership`,
`CityInterest`, and `VisitorAnnouncement`.

**Recommendation: keep home on `User.cityId`; optionally merge
`CityMembership` + `CityInterest` into one table with a `relationship_type`.**

Reasoning:

- `User.cityId` is `NOT NULL`, which is a *stronger* guarantee than a partial
  unique index: one home city is unrepresentable otherwise, not merely rejected.
- It is read by ~25 call sites through `resolveCityId`, **and by authorization**
  (`canActInCity` in `lib/access.ts` compares `session.cityId` to a resource's
  city to scope moderators). Moving home into a join table turns every
  permission check into a join and puts authorization behind a nullable lookup.
  That is the highest-risk change in the entire brief for the least user-visible
  gain.
- `VisitorAnnouncement` already stores visiting with dates, is public-facing, and
  has its own moderation and expiry. Folding it into `UserCity` would be a
  rewrite of a working feature, not a migration.

Merging membership + interest is cheap and does match the brief's intent: both
are `(userId, cityId)` with a unique pair, and one type transitions to the other
when a city goes live.

### 3.2 Home city is not member-editable

`User.cityId` cannot be changed by a member — `/api/auth/me` PATCH does not
accept the field, and there is no picker in settings. Changing it is currently a
database operation.

This is a genuine gap against §21, and a real product decision rather than a
missing form: switching home city re-scopes every feed, while the member's
existing RSVPs and club memberships stay in the old city. Options are recorded
in §5.

### 3.3 `Club.cityId` is required; the brief wants nullable for global clubs

Currently every club belongs to exactly one city. The brief wants
`city_id = NULL` to mean global (Cultures of the World, Language clubs).

This needs an owner decision **before** any migration, and per §6 must not be a
blanket stamp. Istanbul has 166 clubs; the candidates for "global" have to be
listed and classified by hand. That list is not in this document because
producing it is a judgement call about the product, not something to infer from
names.

### 3.4 City field deltas

| Brief | Exists | Note |
|---|---|---|
| `country_code` | `country` | Already ISO-3166 alpha-2 (`TR`), rendered via `Intl.DisplayNames` |
| `region`/`state` | — | Not present; no current use |
| `image` + `hero_image` | `heroImage` only | One image is used in both card and hero today |
| `is_active` | — | `status` covers it: `paused` hides a city entirely |
| `sort_order` | — | Sorted by status rank then name |
| `updated_at` | — | Missing; worth adding |
| `description`, `tagline` | Both exist | |

### 3.5 Route shape

The brief prefers `/cities/<citySlug>`; the implementation uses `/<citySlug>`.

`/<citySlug>` is already live, in the sitemap, in OG canonicals and linked from
the nav, footer and city cards. Moving it would mean redirects and re-indexing
for no user-visible benefit. **Recommendation: keep `/<citySlug>` and record the
deviation.** Note it is a dynamic segment at the site root, so it only catches
paths no static route claims; unknown slugs 404.

### 3.6 Status vocabulary

| Brief | Exists |
|---|---|
| `coming_soon` | `coming_soon` |
| `launching` | `preparing` (same meaning, different word) |
| `live` | `live` |
| `active`, `established` | — |
| — | `paused` (hides a city; the brief has no equivalent) |

**Recommendation: do not add `active`/`established` as statuses.** They describe
engagement, not lifecycle, and are derivable from the counts already shown on the
card. Encoding them as status means someone must remember to promote a city by
hand, and a stale value then misrepresents it. Keep `paused` — it is the only
way to withdraw a city without deleting data (§35).

### 3.7 First Table does not exist

No schema, no matcher, no routes. §37 is a no-op — there is nothing to make
city-scoped. Two adjacent features exist and are easy to confuse with it:

- **First-event matcher** — `EventRecommendation`, recommends a first event to
  newcomers. Already city-scoped through the events it draws on.
- **First-RSVP nudge** — an email sweeper with a randomised holdout.

If First Table is planned, it should be designed city-scoped from the start.

### 3.8 Analytics

PostHog is in use with snake_case events (`application_submitted`,
`club_joined`, …). None of `city_page_view`, `city_join`, `city_interest`,
`city_switch` are emitted. This is the cheapest item in the brief and the one
with the clearest payoff, since nav and city-switching behaviour is currently
guesswork.

---

## 4. Invariants a Pass B must not break

1. **Authorization must never read the viewing city.** `resolveCityId` honours a
   cookie override so a member can browse another city; `canActInCity` reads
   `session.cityId` directly. A moderator viewing Athens must not moderate it.
   There is a test pinning this (`tests/viewCity.test.ts`).
2. **Only live cities are joinable or viewable.** Enforced in `joinCity` and in
   the view-city endpoint, not at the call site.
3. **Non-live cities show no statistics.** Enforced in `getPublicCities`, not per
   caller — zeros read as a dead community.
4. **Client components must not import prisma.** `lib/cityStatus.ts` (pure) is
   separate from `lib/cities.ts` (server) for this reason; the same split exists
   for `lib/neighborhoods.ts` / `lib/neighborhoodsDb.ts`. Violating it fails the
   build with an unrelated-looking `Can't resolve 'fs'`.
5. **The application/approval flow is untouched** and must stay so (§23).

## 5. Proposed Pass B scope

Given how much exists, a Pass B is small. In priority order:

1. **Emit the four analytics events** (§36). No schema. Highest information gain.
2. **Member-facing home city change** (§21) — needs a decision first: does
   changing home city move the member's club memberships and RSVPs, or leave
   them and add the old city as a joined city? Recommend the latter, so history
   stays reachable.
3. **Merge `CityMembership` + `CityInterest`** into one relationship table
   (§3.1), keeping home on `User.cityId`. Migration + rollback; both tables are
   small (interest rows only, no membership rows in production yet).
4. **Global clubs** (§3.3) — only after the owner classifies which clubs are
   global. Migration makes `Club.cityId` nullable; read paths must then include
   `OR cityId IS NULL` wherever clubs are listed.
5. **City fields**: add `updatedAt`, and `sortOrder` if manual ordering is
   wanted.
6. **Per-section empty states** on the city page (§30) — currently a non-live
   city gets a holding page, but a live city with no events shows a missing
   section rather than an invitation.

Not recommended: renaming statuses, moving the city route, or restructuring
home city into a join table.

## 6. Verification of current state

```
cities:      6 rows — istanbul, izmir, bodrum (live); ankara, antalya, bursa (coming_soon)
istanbul:    1,461 approved members · 147 active clubs · 33 upcoming events
izmir:       0 members · 3 active clubs · 1 host
bodrum:      0 members · 3 active clubs · 1 host
```

Istanbul functions as a normal City row; nothing about it is special-cased in
code.
