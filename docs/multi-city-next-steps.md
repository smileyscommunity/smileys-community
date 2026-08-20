# Multi-city: what to build before city three

Written 2026-08-19. Companion to `city-launch-checklist.md`, which says how to
launch a city with what exists today. This says what's missing.

The prompt for it was an outside review of the multi-city architecture. That
review was worth reading and got two things factually wrong, because it was
reasoning from a written description and had no access to this repo. Every
claim below was checked against the code instead, and the check is quoted with
each item so the next person can re-run it rather than trust it.

**The framing that survived the review:** what exists is a city *provisioning*
system — create, edit, set status, assign hosts, seed clubs. There is no city
*operations* system. `/admin/cities` answers "does Bodrum exist"; nothing
answers "is Bodrum healthy", and nobody but an admin can act on the answer.

---

## Settled — do not redo these

Checked, already correct. Changing them would be a regression.

- **`Club.cityId` is already nullable** (`String?`) with a relation comment
  about clubs appearing in every live city's grid. The global-club case is
  handled; no migration needed.
- **The go-live gate is real, not just a doc.**
  `app/api/admin/cities/[id]/route.ts` blocks a move to `live` unless the city
  has ≥1 active club and ≥1 unrevoked `CityHost`, and names the counts in the
  error.
- **Keep `preparing`.** It is not a decorative label: it is a public status
  (`lib/cities.ts` `PUBLIC_STATUSES`), carries its own sort weight, renders its
  own "✦ Preparing" copy on `/apply` and `/[city]`, and is the fallback the
  go-live gate tells you to use. A review suggested cutting it as a no-op; it
  isn't one.

---

## 1. The gate enforces the wrong blocker

**Evidence.** `city-launch-checklist.md` §2 calls neighborhoods *"this one is a
launch blocker"* — the only item in the file marked that way. The gate in
`app/api/admin/cities/[id]/route.ts` counts clubs and hosts and never looks at
neighborhoods. The doc and the code disagree about what blocks a launch, and
the code is the one that runs.

A city can go `live` today with zero neighborhoods, which is precisely the
failure the checklist describes: every neighborhood picker renders an empty
dropdown and `safeNeighborhoodFor` silently nulls whatever is submitted, so the
field looks saved and comes back blank.

**Change.** Add an active-neighborhood count to the same `Promise.all` in that
gate and include it in the refusal message, in the existing voice ("…it has 0
neighborhoods…").

**Done when.** A city with clubs and a host but no neighborhoods is refused
`live`; the message names all three counts; a test in `tests/cityLaunch.test.ts`
covers the neighborhood-only-missing case. Confirm the test fails with the
count removed — a guard that passes against the unfixed code is worthless.

**Effort.** Under an hour. **Risk.** Low.

---

## 2. Club seeding has no status gate — this is what produced Izmir

**Evidence.** `app/api/admin/cities/[id]/launch-clubs/route.ts` checks the
caller's permission, that cross-city seeding is admin-only, and that the city
exists. It never checks status. Production today:

    izmir    coming_soon   0 members   0 events   11 clubs

Eleven clubs and nobody in them. That is a template dump wearing a community's
clothes, and it is worse than showing nothing, because the city looks
abandoned rather than unstarted.

**Change.** Refuse seeding while the city is `coming_soon`. Seed at `preparing`,
which is exactly the state that exists for "hosts are setting this up and
members can't see it yet".

**Done when.** Seeding a `coming_soon` city returns 400 with a message pointing
at `preparing`; seeding a `preparing` or `live` city still works; a test covers
both. Decide separately what to do about Izmir's existing 11 clubs — leaving
them is a data decision, not a code one.

**Effort.** Under an hour. **Risk.** Low. Does not touch existing rows.

---

## 3. No template provenance on seeded clubs

**Evidence.** The `Club` model has no `templateKey` or equivalent — nothing
records that a club came from `lib/clubTemplates.ts`, or which entry.

Cheap now, expensive later: the moment two cities want different starter sets
(Bodrum wants beach clubs, Ankara wants embassy/expat ones), there is no way to
tell a template-derived club from a member-created one, and no way to update a
template's clubs across cities.

**Change.** Nullable `templateKey String?` on `Club`, set by the seeder. A
migration, not a backfill — existing clubs keep `null`, which correctly means
"we don't know".

**Done when.** Newly seeded clubs carry their template key; the migration is
written and applied with `prisma migrate deploy` (never `db push` — see
CLAUDE.md for why that cost us a silent backfill on 2026-08-16).

**Effort.** An hour including the migration. **Risk.** Low, but it is a schema
change: migrations lead the code, so apply before deploying anything that reads
the column.

---

## 4. The moderation queues are city-blind

**Evidence.** Eight report routes exist:

    api/reports · api/admin/directory/reports · api/admin/directory/reports/[id]
    api/listings/[id]/report · api/directory/[id]/report · api/board/[id]/report
    api/neighborhoods/[slug]/posts/[postId]/report · api/csp-report

Zero of them reference `cityId` or `canActInCity`.

Moderators are city-scoped by design — `canActInCity` limits them to their own
city and fails closed when they have none — and then they are handed a global
queue. Two consequences, one operational and one an authorisation gap: Istanbul
is ~99% of the volume so small-city reports starve at the bottom of the list,
and a moderator in one city can act on another city's reports.

**Change.** Scope the admin-facing queues with `canActInCity` and default the
list to the actor's own city. Start the wider route triage here rather than
walking all 99 routes.

**Done when.** A moderator's queue shows only their city; an admin still sees
everything; acting on an out-of-city report is refused server-side, not merely
hidden in the UI.

**Effort.** Half a day. **Risk.** Medium — check whether these routes are
moderator-reachable or admin-only before assuming severity.

---

## 5. No per-city audit trail

**Evidence.** `AuditLog` carries `action` and `targetType`; there is no city
column. "What happened in Bodrum" cannot be answered.

**Change.** Nullable `cityId`, populated by `writeAudit` where the target has
one, and a city filter on the admin audit view.

**Effort.** Half a day with the migration. **Risk.** Low.

---

## 6. `CityHost` is a grant with no console — the real gap

**Evidence.** The `CityHost` model exists and is complete (userId, cityId,
status, grantedBy/grantedAt/revokedAt, unique on user+city), and `/admin/cities`
can grant and revoke. But `CityHost` appears in only six files, every one of
them admin or public display. And `app/host/layout.tsx` gates on
`isClubHost || role === 'admin' || role === 'moderator'` — so a CityHost who is
an ordinary member gets **no surface at all**. The permission was built; the
thing it protects was not.

This is why every city costs the owner's personal attention, and it is the item
that decides whether city ten is possible. At 50 cities no central admin can run
them: city hosts must be able to run events, approve members, assign club leads
and edit their own shopfront without escalating.

**Change.** A decision first, then a build. Either extend the existing `/host`
surfaces to `CityHost`s scoped to their city, or add a thin `/[city]/manage`.
The first is less code and reuses what club hosts already have; the second keeps
city operations separate from club operations, which is the cleaner long-term
shape. Recommend the first for city three, the second before city ten.

**Effort.** Days, not hours — this is a project. **Risk.** Medium-high: it grants
a new class of user write access, so every new surface needs `canActInCity` on
the server and a guard test, not a hidden nav item.

---

## 6b. The view-city cookie survived sign-out — fixed 2026-08-19

Recorded because the *class* of bug will recur: `smileys_city` is per-person
state living in a per-browser cookie, and it was written only by
`/api/city/enter` and `/api/me/view-city`. Nothing else touched it — not login,
not logout, not a home-city change.

So on a shared browser: look at Bodrum, sign out, next member signs in, and
they land in Bodrum rather than their own city with nothing on screen to
explain it. Nothing leaks — the override only picks which city's *public*
content renders, and authorization is by session throughout — but "sign in and
land in my city" fails silently, which is how it gets reported as "the city
switcher is broken on mobile".

`deleteSession` now clears it, by setting empty with `maxAge: 0` and the same
attributes rather than `delete()`: on https the original is Secure, and a
non-Secure `Set-Cookie` may not overwrite a Secure one, so a bare delete
silently no-ops on iOS. `/api/city/enter` had already learned that.

Deliberately **not** cleared on sign-in: a guest who browses Bodrum and then
signs in should stay in Bodrum. Sign-out is where the person changes.

Guarded by `tests/signOutClearsViewCity.test.ts`.

**The general rule:** any per-person preference kept in a cookie needs an owner
in the sign-out path. Check that before adding the next one.

---

## 7. Bodrum is `live` with one member — status is the wrong instrument

**Evidence.** `bodrum · live · 1 member · 1 event · 11 clubs`.

The status is correct. `coming_soon | preparing | live | paused` is a *lifecycle*
vocabulary: it answers "can people sign up, is the shopfront public". Bodrum's
problem is *liquidity* — it is genuinely live and genuinely empty. Overloading
one enum to express both is why "live with 1 member" reads wrong.

**Change.** A second dimension, **derived from data and never admin-set**:
roughly `seeding` (under N active members, no recurring events) → `forming`
(recurring events, host coverage, some retention) → `self-sustaining`
(member-created content). Use it for two things only: honest empty-state copy
("Launching soon · 11 clubs forming · be one of the first"), and an ops signal
when a city sits in `seeding` past ~90 days.

Resist making it editable. The moment an admin can set it, it becomes a second
status field that drifts from reality.

**Effort.** A day. **Risk.** Low — additive and derived.

---

## 8. Cron sweeps still compute one "today" for every city

**Evidence.** `todayIstanbul()` had 83 callers; every surface with a city in
scope now asks that city. Six remain, and they are the ones that genuinely
span cities:

    api/cron/sweep-payment-reminders   api/cron/sweep-waitlists
    api/cron/sweep-review-nudges       api/cron/sweep-event-spots
    api/admin/cron/reminders           lib/newsletterDigest

Each computes a single `today` at the top of its sweep and then queries
network-wide. Harmless while every city shares one zone; the day one doesn't,
that city's members get reminders and digests on the founding city's clock —
hours early or late, and never obviously broken enough to report.

**Change.** Group each sweep by city and ask per city. Not a different
constant: the query shape changes, and these jobs send email, so a mistake is
outbound and irreversible.

**Done when.** A sweep run with two cities in different zones fires each city's
notifications at that city's local time, and a dry-run mode shows what would go
to whom before anything sends.

**Effort.** A day, mostly testing. **Risk.** High for its size — it is the only
item in this document whose failure mode is mail to real members.

---

## Sequence

1, 2, 3 are each an hour or less and should land before city three. 4 and 5 are
about a day together. 6 is the project. 7 whenever the empty-city copy next
annoys someone.

**Coordination, as of 2026-08-19:** a second session has uncommitted work in
`app/api/admin/partners/route.ts`, `app/api/admin/clubs/route.ts`,
`app/api/admin/directory/route.ts`, `lib/city.ts` and a new
`components/admin/CitySelect.tsx` — a `resolveTargetCityId(session, requestedCityId)`
helper so an admin creating a record picks its city explicitly instead of
inheriting their own. That is the right fix for the highest-risk pattern in the
system (implicit city inheritance on create) and should be finished before
anything here. Item 4 overlaps `lib/city.ts`; items 2 and 3 overlap nothing.

## Working rules that apply to all of it

From `CLAUDE.md`, repeated because they are the ones that have actually bitten:

- `npx tsc --noEmit` and `npm test` before considering any of this done.
- Schema changes go through `prisma migrate deploy`, never `db push`.
  Migrations lead the code — a model whose column is missing throws P2022 on
  every query for that model, not just the new feature.
- Never deploy without the owner's explicit confirmation for that specific
  deploy, and take a fresh DB backup immediately before.
- Every guard test must be checked against the *unfixed* code. If it passes
  before the fix, it is testing nothing.
