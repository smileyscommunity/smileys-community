# Admin panel: audit and redesign plan

Written 2026-09-04, after the seventh city was prepared. This is a plan, not a
decision — nothing here has been started.

It deliberately does **not** re-open anything in `docs/multi-city-next-steps.md`.
That document owns the *authority* model (who may act in which city, item 6,
the CityHost console). This one owns the *panel* — how one operator finds and
does the work. They meet in Phase 1, and the note there says how.

---

## What was measured

Code audit, not a look at the rendered screens. Numbers from the tree at
`94c39d4`.

| | |
|---|---|
| Admin pages | 55 (~29,000 lines) |
| Admin API routes | 103 |
| Sidebar items | 41, in 7 groups |
| Mobile nav items | 6, different structure |
| Client components | 53 of 55 |
| Pages fetching in `useEffect` | 43 |
| Shared components in `components/admin` | 11 |
| Pages that know about cities | 24 of 55 |
| Largest pages | analytics 1,529 · applications 1,431 · directory 1,218 · users 1,068 |

Three findings, in the order they hurt.

**1. The panel is not multi-city, though the product now is.** There is no city
control in the admin chrome. City selection is per-page, implemented 24 times,
and 31 pages have no city dimension at all. Some of those are rightly global
(security, settings, content); neighborhoods, hosts, polls, campaigns,
spotlight, announcements, feedback, NPS and retention are not. Answering "how
is Ankara doing" means visiting six pages and setting six dropdowns.

**2. 41 nav items for a job that is about five things.** Marketplace and Moving
Sales are separate; so are Guide resources and Guide experiences; so are
Participants, Check-In and No-shows. The daily loop is approvals, moderation,
events, and lately launching cities. The IA does not say so, and the six-item
mobile nav is a different shape, so neither teaches the other.

**3. Everything is hand-rolled, so everything drifts.** 49 pages hand-roll
`credentials: 'include'`, 46 hand-roll `toast.error`, 28 hand-roll list state.
No shared table, filter bar, modal or fetch hook. `users/page.tsx` inlines
twelve SVGs. This is why the four biggest pages are 1,000–1,500 lines, and why
this morning's currency fix had to touch thirty separate call sites.

---

## Phase 1 — one city context in the chrome

**The change.** A city control in the topbar holding "All cities" plus each
city, persisted (cookie, same shape as the member-side `smileys_city`) and read
by every page through one hook. Pages that are genuinely global render a small
"applies to every city" note instead of inheriting the selection silently.

**Why first.** It is the largest daily improvement, it is judgeable on its own,
and it retires 24 duplicate dropdowns — which makes every later phase smaller.

**Where it meets the authority work.** A moderator or city host must not be
able to *select* a city they cannot act in. The control lists only permitted
cities, and the server keeps deciding: `canActInCity` stays the authority, and
`failClosedCityId` stays the fallback. The control is a convenience over
existing permissions, never a grant. This is the seam where item 6 of
`multi-city-next-steps.md` will land later; do not pre-build for it.

**Scope.** Topbar control, one `useAdminCity` hook, cookie plumbing, and
migrating the 24 pages that already have a dropdown. The 31 city-blind pages
are Phase 4, not here.

**Verification.** A guard test that a moderator cannot select or read another
city through the control, checked against the unfixed code first. The existing
`tests/adminCityScopeSweep.test.ts` and `adminStatsCityScope.test.ts` must stay
green untouched.

**Effort.** 1–2 days. **Risk.** Medium: it touches every admin page's data
call, but no schema and no member-facing surface.

---

## Phase 2 — six primitives

Extract, in this order, each with the pages that adopt it in the same commit:

1. `useAdminResource` — fetch, loading, error, refetch, city-aware. Replaces
   the `useState<T[]>([])` + `useEffect` + `credentials: 'include'` triple on
   43 pages.
2. `DataTable` — sorting, empty state, mobile card fallback.
3. `FilterBar` — search, status pills, date range.
4. `Modal` / `ConfirmDialog` — wrapping the existing `confirmToast` rule
   (never native `confirm()`, it no-ops in the installed PWA).
5. `StatCard` — already duplicated across dashboard, analytics and payments.
6. A shared admin icon set, retiring the inlined SVGs.

**Do not** convert pages wholesale to server components in this phase. Do it
per page in Phase 3, where the win is visible and reversible.

**Effort.** 3–4 days. **Risk.** Low, if each primitive lands with its first two
consumers and no page is left half-migrated.

---

## Phase 3 — split the four monoliths

analytics (1,529), applications (1,431), directory (1,218), users (1,068).

Each becomes a server component that renders with data, plus client islands for
the interactive parts. Applications first: it is the busiest daily page, so the
spinner-then-content delay is felt most there, and it is the best test of
whether the pattern is worth repeating.

**Effort.** 1 day per page. **Risk.** Medium — these are the pages the owner
uses most; ship them one at a time, not as a batch.

---

## Phase 4 — the nav, and the city-blind pages

Collapse 41 items to roughly 12–15 top level, with second-level tabs inside a
page: Events owns participants, check-in and no-shows; Community owns
marketplace, moving sales and hangouts; Guide owns resources and experiences.
Desktop and mobile get the same shape.

In the same pass, give the 31 city-blind pages a city dimension where one is
real, and an explicit global marker where it is not. Decide per page rather
than by rule — this is editorial work, not a sweep.

**Effort.** 2–3 days. **Risk.** Low technically, high in muscle memory: the
owner navigates this panel by habit, so the rename/move list should be agreed
before it is built, not after.

---

## Sequence and working rules

Phases in order; each is independently shippable and independently revertible.
Phase 1 alone is worth doing even if nothing else follows.

- One focused branch. Two sessions collided on the same files on 2026-09-04;
  the panel is worse to share than the content directories were.
- `npx tsc --noEmit` and `npm test` before any phase is called done.
- Every guard test checked against the *unfixed* code — a guard that passes
  before the fix is testing nothing.
- No deploy without the owner's explicit confirmation for that specific deploy.
- The panel is the owner's daily tool. Nothing here should ship the day before
  a city launch.

## What this plan does not cover

The rendered design — spacing, density, colour, typography, the dark zinc
palette — was not audited, because this pass read code rather than screens. If
the visual layer matters as much as the structure, that is a separate look,
and it wants the panel running in front of us.
