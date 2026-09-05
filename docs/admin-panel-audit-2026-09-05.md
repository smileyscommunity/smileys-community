# Admin panel: audit, 2026-09-05

Companion to `docs/admin-panel-redesign-plan.md` (2026-09-04), which owns the
structural findings (city context, nav count, hand-rolled primitives). Nothing
from there is repeated. This pass covered what that one did not: the authority
gates as actually exercised, the moderator's path through the panel, audit
coverage of mutating routes, and page-level failure behaviour.

What was **not** covered, and why: the rendered screens. A local walk-through
needs an admin session; minting one from the local secret was refused by the
tool permission layer, and no signed-in Chrome was connected. The visual pass
the plan asked for is still open and still wants a person logged in.

## Method

- Tree at `82130a7`, local DB snapshot of 2026-09-03 (Istanbul + İzmir only).
- Every admin API route was hit by an anonymous caller with each of its
  declared methods: 182 method/route pairs. A same-origin `Origin` header was
  sent so the CSRF gate did not mask the auth gate.
- Static cross-checks: sidebar roles vs the layout allowlist, mutation routes
  vs `writeAudit`, page fetch handlers vs error surfacing, conventions from
  CLAUDE.md (native dialogs, `hour12`).

## Findings, in the order they hurt

### 1. Nine sidebar entries and the mobile "Notify" tab bounce moderators

`components/admin/Sidebar.tsx` lists these for `moderator`, but
`MODERATOR_ALLOWED` in `app/admin/layout.tsx` does not, so the layout
redirects to Mod Home the moment the page loads:

Feedback · NPS · Campaigns · Moving Sales · Directory · Polls · Guide resources
· Guide experiences · Notifications (also the "Notify" tab in the moderator
mobile bottom nav).

Every one of the APIs behind them admits moderators, city-scoped
(`isAdminOrModerator`, `canSendBroadcasts`, `canManagePosts`, or
`canModerateReports` + `failClosedCityId`). The page gate is the only thing in
the way, and it disagrees with the nav that promised the page. The allowlist
also still names `/admin/engagement`, which has been a redirect stub since the
announcements split.

Fix shape: derive the allowlist from `navItems` (roles include `moderator`)
plus the few non-nav pages moderators need (`/admin/security`,
`/admin/checkin`, `/admin/retention`), so the two cannot drift again. One
guard test: every sidebar href a moderator can see must pass the layout gate.

### 2. The admin 2FA gate has been "TEMP" disabled since 2026-07-04

`app/admin/layout.tsx` sets `needs2fa = false` with a comment describing a
one-day authenticator mix-up. Two months later it is still there. Server-side,
`requireStepUp` protects exactly two routes (`users/[id]` role/delete,
`payments` delete); everything else, including broadcasts, newsletter send,
suspensions, city launch and club deletion, opens with a password and the
7-day cookie. `isAdminStrict` exists and is tested; it is just not reachable
for an un-enrolled admin.

Fix shape: restore the line (the comment already spells out the two
preconditions), then decide which of the outward-facing routes in finding 3
should also call `requireStepUp`.

Done in this tree, 2026-09-05: the gate line is restored (`5b37c5f`).
`requireStepUp` now also guards club deletion, the newsletter's real and
scheduled sends, suspending or banning a member, the global broadcast, and a
city status change in either direction (going live publishes the city and
mails its interest list; leaving live pulls a public city down). Left open
on purpose: the newsletter's preview and test sends (the admin's own inbox),
lifting a suspension, and city copy edits. `tests/adminStepUpRoutes.test.ts`
pins each side.

### 3. Four routes that email members write no audit row

Corrected after a closer read (the first draft of this finding counted 23
routes and named seven as mattering; three of those seven keep their own
trail, see below). Fixed in this tree:

- **Sends with no trail, now audited:** `events/[id]/remind-attendees`
  (`event.remind_attendees`), `events/[id]/notify-noshows`
  (`event.notify_noshows`), `tools/login-nudge` (`users.login_nudge`, only
  when someone was actually nudged), `users/[id]/resend-approval`
  (`user.resend_activation`). Each can email tens of members; before this
  none left a row saying who pressed it. The rate limit (3/hour/event) capped
  the damage but not the attribution.
- **Not gaps, on inspection:** `no-show/cards/[id]` PATCH delegates to
  `lib/noShow.resolveCard`, which writes `no_show.<action>` itself;
  `users/[id]/notes` stores `adminId`/`adminName` on the note row;
  `users/reengage` only drafts text with the model and sends nothing.
  `notifications/broadcast` has the Broadcast table, `announcement` keeps
  `updatedBy`, and the three AI helpers (`screen`, `welcome`, `triage`)
  mutate nothing.
- **Creates still unaudited, low stakes:** `events`, `clubs`, `cities`,
  `listings`, `tags`, `tag-groups`, `testimonials` POST/PATCH,
  `story-photos`, `neighborhoods/[slug]/image`, `clubs/[id]/recount`. Each
  leaves a row in its own table with a creator or timestamp; fold into Phase 2.

Seen in passing: the `users/reengage` prompt still says "the Smileys
community team in Istanbul" for every city's members. Copy leak, one line.
Fixed 2026-09-05: the prompt names the member's own city.

Also 2026-09-05: `tests/adminAuditTrail.test.ts` pins the four rows above
(they landed without a test), including the login nudge's deliberate
no-row-when-nobody-qualified case. The unaudited creates are recorded in
the redesign plan under Phase 2.

### 4. Three pages turn a failed request into "nothing here"

`audit`, `moderator` (Mod Home) and `nps` do `r.ok ? r.json() : []`/`null`
and render the empty state. A 403 (moderator with no city, revoked session) or
a 500 looks identical to a quiet day. Mod Home is the moderator's landing
page, so a broken `mod-stats` reads as "no work". Every other page reaches
`toast.error` or `LoadErrorBanner`.

Fixed in `aafe4fb`. A second sweep on 2026-09-05 found five more primary
loads with the same shape, missed because their pages toast on
*mutations* and so looked handled: `retention` (a moderator page — a 403
read as "Failed to load retention data." with no reason and no retry),
`feedback` (the "no feedback yet" primer stayed up), `campaigns/[id]` (the
skeleton pulsed forever), `notifications` (the broadcast history read "No
broadcasts sent yet."), and `users`, which never checked `r.ok` at all, so
an error body simply wasn't an array and the list said "No users found."
All five now go through `loadFailure` and render `LoadErrorBanner`;
`tests/adminLoadFailureSurfaced.test.ts` ratchets all eight pages, with a
per-page allowance for the secondary lookups that may still fall back
quietly (a sample event, the composer's option lists, connection flags).

### 5. Dead nav code in the layout

- `bottomNav` in `app/admin/layout.tsx` is computed on every render from
  `navItems` and never rendered; the JSX uses two hard-coded arrays.
- `roles: ['host']` on Events, Participants and Check-In can never match:
  the layout admits only `admin` and `moderator`, so a club host never reaches
  `/admin`. Hosts have their own panel; the role tag is a leftover.

  **Withdrawn 2026-09-05.** The tag matches for a *moderator* who also hosts
  a club: the sidebar builds the viewer's roles as `[role, 'host'?]` from
  `user.isClubHost`, so those three items appear for them, and the events,
  participants and check-in APIs all admit a club host. Four of the current
  moderators host a club, so this is live behaviour, not dead code. The
  first bullet (the unrendered `bottomNav`) was real and is fixed in
  `aafe4fb`; the page gate (finding 1) admits the `host` items for exactly
  this reason, and `tests/adminModeratorPageGate.test.ts` pins both the
  derivation and the gate.

## What held up

- **Anonymous access:** 179 of 182 method/route pairs answered 401/403.
  The three that did not are intentional: `announcement` GET (strips
  `updatedBy` for guests), `banners` GET (filters to `active` for guests),
  both consumed by member-facing components. The CSRF origin check returns
  403 on a POST with no `Origin`. No route 500'd on a guest hit; the dev
  server error log stayed empty through the sweep.
- **Step-up and city scoping** on the routes that have them match
  `lib/access.ts`; nothing hand-rolls a role string except `security`,
  which says why.
- **Conventions:** no native `confirm/alert/prompt` in admin code, no
  `hour12`. Tables that used to eat their last column now scroll (`3b140d6`).

## Suggested order

1 and 2 are each under an hour and change what a moderator or a thief can do
today. 3 is done in this tree. 4 and 5 are tidy-ups to fold into Phase 2 of the
redesign plan, not separate work.
