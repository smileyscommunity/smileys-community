# Multi-city Pass B — implementation report (2026-08-16)

Scope approved by the owner from the audit's §5: analytics events,
home-city change (keep + auto-join old city), membership/interest table
merge, per-section empty states, global-club candidate list. All on
`feature/multi-city`.

## 1. What changed

| Commit | Change |
|---|---|
| `ae0eb8f` | `city_page_view` + `city_switch` events; live-city empty states for events/clubs sections (rode along — both touch `app/[city]/page.tsx`) |
| `0973221` | Home-city change: `setHomeCity()` + `PUT /api/me/cities` + settings picker; `city_join` / `home_city_changed` events |
| `67b85d6` | `CityRelationship` table replacing `CityMembership` + `CityInterest`; `city_interest` event |
| `258d821` | `docs/global-club-candidates.md` for owner markup |

Earlier the same day (also this branch): city-entry cookie flow, the
"✕ Back to my city" switch, and city-aware heroes on events/clubs/directory.

## 2. Schema + migrations

`prisma/migrations/20260816000001_merge_city_relationships/`:
- `migration.sql` — creates `city_relationships`, copies memberships
  (`type='member'`, joinedAt→createdAt) then interests (`'interested'`,
  members win conflicts), drops both old tables.
- `rollback.sql` — lossless restore of both tables from the merged rows,
  plus the `_prisma_migrations` cleanup line.

**NOT run against production** (prod holds 2 membership + 4 interest rows).
**Deploy order is load-bearing: run `migration.sql` on prod (after
pg_dump) BEFORE the next deploy** — the deployed code still reads the old
tables; the committed code reads the new one. Applied to the local DB and
exercised end-to-end.

Semantics deviation from the brief, recorded deliberately: unique on
`(userId, cityId)` **without** type — member-and-interested in one city is
a contradiction, so it's unrepresentable; interest transitions to
membership on join (tested).

## 3. Behaviour decisions implemented

- **Home move keeps history**: old home becomes a joined city in the same
  transaction; any relationship row for the new home is removed (home
  lives on `User.cityId` only). Live-city targets only; unapproved
  members refused. No re-login needed — `getSession` injects fresh cityId.
- **Leave / withdraw are type-scoped**: leaving a city deletes only
  `member` rows; withdrawing interest only `interested` rows.
- **Empty states** (§30): a live city with no events shows "Events are
  coming soon — be one of the first" + JoinCityButton; no clubs shows
  "Clubs are forming" + Become a host → `/get-involved`. No new forms.

## 4. Analytics

`city_page_view {city, status}` (client, incl. guests) ·
`city_join {city}` · `city_interest {city}` (first press only) ·
`city_switch {city, via: selector|city_page|back}` ·
`home_city_changed {city}` — all through the existing `track` /
`trackServer` helpers (`trackServer` skips staff by design).

## 5. Preserved

Application/approval flow untouched. `/api/me/cities` GET/POST/DELETE
response shapes unchanged. Authorization still reads `session.cityId`
only. All prior URLs intact.

## 6. Tests

255 passing (5 new: home-move transaction legs, interested→member
transition, type-scoped leave). E2E against local dev: interest → join →
home-move lifecycle verified through the real endpoints, then reverted.
İzmir page renders the events empty state; guide/neighbourhood sections
stay Istanbul-only.

## 7. Known issues / next

- **Blocked on owner**: mark up `docs/global-club-candidates.md`, then the
  nullable-`Club.cityId` migration + read paths (one sitting).
- Events/clubs pages' `<title>` metadata is still static default-city text.
- `city_switch` from the public enter route is members-only (guests carry
  no server-side distinct id).
- Minor City fields (`updatedAt`, `sortOrder`) not added — not selected.
