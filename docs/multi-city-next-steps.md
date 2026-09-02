# Multi-city: state of play

Rewritten 2026-09-03. Supersedes the 2026-08-19 version, which listed eight
items "to build before city three". Four of them were fixed the same day it
was written and it was never updated, so it kept sending readers after bugs
that no longer existed. Companion to `city-launch-checklist.md`, which says
how to launch a city with what exists today. This says what is settled, what
is still open, and — the part that matters most now — what the numbers say.

Every claim below was checked against the code on 2026-09-03, and the check
is quoted so the next person can re-run it rather than trust it. Items are
kept under their original numbers so old references still resolve.

**The framing that still holds:** what exists is a city *provisioning*
system — create, edit, set status, assign hosts, seed clubs — plus, since
August, the first pieces of a city *operations* system: a derived health
stage, city-scoped moderation, city hosts who can actually enter the panel.
Nobody but an admin can yet run a city end to end.

---

## Settled — do not redo these

Checked, already correct. Changing them would be a regression.

- **`Club.cityId` is nullable** (`String?`): global clubs appear in every
  live city's grid. No migration needed.
- **Keep `preparing`.** A public status with its own copy on `/apply` and
  `/[city]`, and the state the go-live gate and the seeder both tell you to
  use. Not a decorative label.
- **1. The go-live gate blocks on the real blockers** — `f38780e`,
  2026-08-19. `app/api/admin/cities/[id]/route.ts` refuses `live` unless the
  city has ≥1 active club, ≥1 unrevoked `CityHost` *and* ≥1 active
  neighborhood, and names all three counts. Guarded by
  `tests/cityGoLiveGate.test.ts`.
  Re-check: `grep -n "neighborhoods === 0" "app/api/admin/cities/[id]/route.ts"`.
- **2. Club seeding has a status gate** — same commit. Seeding a
  `coming_soon` city is refused with a message pointing at `preparing`.
  Re-check: `grep -n coming_soon "app/api/admin/cities/[id]/launch-clubs/route.ts"`.
- **3. Seeded clubs record their template** — `33a0b58`, 2026-08-19.
  `Club.templateKey`, set by the seeder, `null` on member-created clubs.
  Guarded by `tests/clubTemplateProvenance.test.ts`.
- **7 (code half). City maturity is a derived stage** — `deecd2c`,
  2026-08-19. `lib/cityMaturity.ts` classifies `seeding | forming |
  self_sustaining` from data, never admin-set, and drives the honest
  empty-state copy on the shopfront ("Founding stage … founding member #N").
  Guarded by `tests/cityMaturity.test.ts`. The data half is §7 below.
- **8. Sweeps ask each city what day it is** — `6c18edf` + `6b6e54d`,
  2026-08-20. Every cron groups by `citiesByToday()`; the hardcoded-zone
  ratchet in `tests/timezoneHardcoding.test.ts` stops new pins.
  Re-check: `grep -rln todayIstanbul app/api/cron app/api/admin/cron lib`
  returns only a comment in `lib/city.ts`.
- **6b. The view-city cookie is cleared on sign-out** — 2026-08-19,
  `tests/signOutClearsViewCity.test.ts`. General rule that still applies:
  any per-person preference kept in a cookie needs an owner in the sign-out
  path. Check that before adding the next one.
- **The public per-city SEO surface exists** — `a8c0681` + `bc7da5d`,
  2026-09-02/03. `/[city]/{events,clubs,directory,board}` are server-rendered
  hubs, city fixed by the URL. Canonical rule: the default city keeps
  `/events` etc. (URLs Google already ranks); every other city's hub is
  canonical to itself; the global pages point at the hub when a viewer is
  pinned to another city. Rules and loaders in `app/[city]/data.ts`, tests
  in `tests/cityHubs.test.ts`. The global `/events`, `/clubs`, `/directory`,
  `/board` remain the members' interactive, cookie-scoped views.

---

## 4. Moderation queues — closed 2026-09-03

**Then:** eight report routes, none referencing `cityId`.

**Now.** The moderation queue is city-scoped and refuses cross-city action
server-side: `app/api/admin/moderation/route.ts` and `[id]/route.ts` scope by
the reported member's city through `failClosedCityId` / `canModerateReports`,
guarded by `tests/adminCrossCityModeration.test.ts`. The member-facing
`…/report` routes (listings, directory, board, neighborhood posts) need no
scoping — a member reports what they can see; the city rule belongs to the
queue that reads the report. `app/api/admin/directory/reports/route.ts`
filters through the reported business's city
(`tests/adminDirectoryReportsScope.test.ts`).

**The audit this item always stood for ran on 2026-09-03.** Every
moderator-reachable route under `app/api/admin` was read for server-side
city scoping. Twelve had none and three were partial; all are fixed. The
rule everywhere: a moderator sees and acts on their own city (plus
network-wide rows where a `cityId: null` row exists — broadcasts, clubs,
posts, testimonials), fails closed with no city, and cannot widen the scope
with `?city=`; an admin sees everything and may narrow.

- Lists: `listings`, `moving-sales`, `partners`, `directory/claims` (through
  the claimed business), `notifications/broadcast`, `clubs`, `posts`,
  `testimonials`, `surveys` (every rollup and the CSV, through the event's
  city), `nps` (through the responder, still anonymous), `cities` (host
  lists only for cities the caller may act in).
- Row actions: `partners/[id]` PATCH/POST/DELETE, `posts` POST and
  `posts/[id]` GET/PUT/DELETE (re-pinning a post to another city is a
  403), `clubs/[id]` GET (audit `meta` stays admin-only),
  `testimonials` POST/reorder and `testimonials/[id]` PATCH/DELETE,
  `spotlight` POST (featuring another city's member), `tools/login-nudge`
  (outbound mail reaches the moderator's own city only).

Guarded by `tests/adminCityScopeSweep.test.ts` — sixteen cases, run against
the unfixed routes first: all sixteen failed there, all pass now.

**Working rule for new admin routes.** Any route that
`isAdminOrModerator` can reach scopes its reads with
`isAdmin(session) ? {} : { cityId: failClosedCityId(session) }` and gates
its writes with `canActInCity(session, row.cityId)` — and adds a case to the
sweep test.

---

## 5. Per-city audit trail — closed 2026-09-03

`AuditLog.cityId` (nullable, indexed with `createdAt`). `writeAudit` resolves
it from the target — a member's home city, an event's city, a card or a
payment through its event, the city itself — rather than by its 96 call
sites; a caller that already knows the city passes `meta.cityId`. Targets
with no city (settings, the Cup, tags) and every row from before the column
stay null. `/admin/audit`: moderators see their own city's rows plus the
city-less ones (so the history they could always read didn't vanish the day
the column arrived); admins see everything and can narrow to one city.
Guarded by `tests/auditCity.test.ts`, run against the unfixed code first.
Re-check: `grep -n cityId lib/audit.ts app/api/admin/audit/route.ts`.

Not backfilled: old rows would have to be guessed at from targets that may
no longer exist. If a backfill is ever wanted, it is one script over
`targetType`/`targetId` with the same resolver.

---

## 6. `CityHost` — the grant grants something now; the console is still the project

**Then:** a `CityHost` row gave an ordinary member no surface at all.

**Now** — `e10c30a`, 2026-08-30. `hostCityIds` rides the login / `/me` / 2FA
payloads, `/host` and the host APIs accept city-host authority (data still
pinned to the caller's own events), `canHostInCity` gates event creation
without a club, the account menu lights up. The Bodrum consul can enter the
panel. 27 tests, `tests/cityHostAccess.test.ts` among them.

**What is open.**
- Of the host API routes, `events`, `impact`, `clubs` and `events/[id]/
  broadcast` check host authority; `events/describe`, `events/suggest-tags`
  and `quality` do not reference it. Two are AI helpers with no data access
  and may be fine; verify rather than assume.
- The decision the old version asked for still stands: extend `/host` to
  city hosts scoped to their city (less code, what has been happening), or
  add a thin `/[city]/manage` (cleaner long-term shape). Recommendation
  unchanged: the first for now, the second before city ten.
- A city host still cannot approve members, assign club leads or edit their
  own shopfront without an admin. That is the actual "operations" gap, and
  it is what decides whether the owner's attention scales.

**Effort.** Days. **Risk.** Medium-high: every new surface needs
`canActInCity` on the server and a guard test, not a hidden nav item.

---

## 7. Liquidity, not status — signal wired 2026-09-03; the rest is ops

Production on 2026-09-03 (`SELECT … FROM cities` joined to approved members,
active clubs and upcoming published events):

    istanbul   live   1630 members   115 clubs   20 upcoming events
    antalya    live     10 members     3 clubs    0 upcoming events
    izmir      live      3 members     3 clubs    0 upcoming events
    bodrum     live      2 members     3 clubs    0 upcoming events
    ankara     coming_soon · bursa    coming_soon

The status vocabulary is right and the derived stage is honest; all three
small cities read as "seeding" and say so. But three live cities have no
upcoming event between them. Everything shipped in September — no-show
cards, day-before reconfirmation, the per-city hubs — only helps a city that
has events. No further code changes this. What does: a host, a first
recurring event, and the founding members that follow it. That is an
operations decision per city, and the maturity stage exists so the ops
signal ("in `seeding` past ~90 days") is visible rather than felt.

**The signal is now on the dashboard (2026-09-03).** `lib/cityOps.ts`
lists live cities with no upcoming event, with how long each has been live
(from the `city.status_change → live` audit row, falling back to the city's
`createdAt`). `/api/admin/stats` returns them as `stalledCities`, scoped to
`?city=` like every other number there, and the admin dashboard shows one
pill: "3 live cities with no upcoming event: Antalya (10 members · no
upcoming event · live 3d) · …", amber for the first thirty days live and
red after (`STALLED_RED_AFTER_DAYS`). It links to the cities page, where the
city's hosts are. Guarded by `tests/cityOps.test.ts` and the two stalled
cases in `tests/adminStatsCityScope.test.ts`.

**The ops plan per city, as of 2026-09-03.** Antalya has one city host and
two members who marked interest; the first move is that host publishing one
recurring free event (a weekly coffee or walk — free, so the no-show cards
and reconfirmation apply). Izmir has two city hosts and fifteen unpublished
guide drafts; a small first meetup plus publishing the drafts gives the
city both a calendar and a reason to be found. Bodrum has two members but
nine Istanbul members who marked interest; the lever is a weekend event
aimed at them, hosted from Istanbul until a local host emerges. None of the
three has a consul. The pill stays red until each has one event up — that
is the whole point of it.

**Possible next code step, not started.** A weekly nudge to the hosts of a
stalled live city ("your city has nothing coming up — here is the event
form"), built on the login-nudge pattern. Worth it only if the pill goes
ignored for a month; a human message from Nate does more the first time.

---

## 9. The default city is a constant — leave it until there is a reason

`lib/city.ts`: `DEFAULT_CITY_SLUG = 'istanbul'`, referenced from 25 files.
It does three jobs: the fallback scope for any cookie-less request, the
anchor for canonical decisions (which URLs Google already ranks), and the
marketing home. Two of those need *a* default whoever it is; only the name
needs to leave the code, and a `City.isDefault` flag would take about two
hours and change nothing a visitor sees. The real question is product, not
code: whether a first-time visitor should be routed by geography or language
instead of landing on one city. Decide that when there is a non-Turkish
city.

One exception worth doing sooner: `lib/guideContent.ts` references the
constant eleven times, as content fallbacks to the founding city's JSON.
Those are the kind of founding-city-ism `tests/cityHardcoding.test.ts` exists
to catch. Re-check: `grep -c DEFAULT_CITY_SLUG lib/guideContent.ts`.

---

## Landed since, that the next reader should know

- **No-show cards + day-before reconfirmation** (2026-09-02, `464d408` …
  `d85d3d8`). Policy in `lib/noShowPolicy.ts`; per member, across cities;
  free events only. The sweeps are per-city like every other cron.
- **Migration history baselined** (`7271524`). One folder; the old 51
  could not rebuild a database. New migrations go after it as usual.
- **`app/[city]/page.tsx` decomposed** (`83c4ade`): `data.ts` + `sections/`,
  verified by diffing rendered HTML before and after.
- **A rule learned the hard way** (`bc7da5d`): Next streams an
  `unstable_cache` value into the page HTML. A loader that feeds the cache
  must select only what the page renders; the first cut of the board hub
  put members' private contact numbers into a guest's page source. Verify
  with a grep of the guest HTML for the private column names.

---

## Sequence

The 4 audit and 6 are the real work, and 6 is the project. 9 waits for
a reason. 7 is not on this list because it is not code.

## Working rules that apply to all of it

From `CLAUDE.md`, repeated because they are the ones that have actually bitten:

- `npx tsc --noEmit` and `npm test` before considering any of this done.
- Schema changes go through `prisma migrate deploy`, never `db push`.
  Migrations lead the code — a model whose column is missing throws P2022 on
  every query for that model, not just the new feature.
- Never deploy without the owner's explicit confirmation for that specific
  deploy. Push `main` after every verified deploy.
- Every guard test must be checked against the *unfixed* code. If it passes
  before the fix, it is testing nothing.
- Anything a loader puts into `unstable_cache` reaches the browser. Cache
  only rendered fields, and sweep the guest HTML for private columns.
