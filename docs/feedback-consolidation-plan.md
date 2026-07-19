# Feedback System — Inventory & Consolidation Plan

_Status: proposal for review. Nothing here is built yet._

## TL;DR

The app has **6 feedback mechanisms**. They feel confusing because two of them
(event **review** and event **survey**) fire on the same moment and look alike —
but they are **not redundant**: one is *public and named*, the other is
*anonymous*. They can't be merged into one table without breaking anonymity.

**The real fix is UX, not schema:** collapse the duplicate *prompts* into one
post-event card, and collapse the scattered *admin pages* into one Feedback hub.
Keep the underlying data models where their visibility rules differ.

---

## The mental model that removes the confusion

Feedback has two axes — **what it's about** and **who's allowed to see it**:

| Target | Public & name-attributed | Anonymous (private audit) |
|---|---|---|
| **An event** | Event review (`reviews`) | Event survey (`event_surveys`) |
| **A venue** | Venue review (`business_reviews`) | — |
| **The whole product** | — | NPS (`member_nps`) |

Once you see it this way, nothing is truly redundant — but the **event row has
two cells**, and today each cell is a *separate prompt and separate admin
surface*. That doubling is the confusion. Everything else is already one-per-cell.

---

## Full inventory

### 1. Event review — `Review` / `reviews` (114 rows) · PUBLIC, named
- **Prompts:** `/reviews` page, inline form on the event page (`EventReviews.tsx`),
  and the violet `ReviewReminder` dashboard card. No cron.
- **Shows up:** event page (logged-in members), club "Reviews" tab, and the 4★+
  activity wall. Name-attributed.
- **Admin:** no dedicated page — only indirectly via the activity wall.

### 2. Club reviews — **same `reviews` table**, no separate model
- A read-only *view*: `GET /api/clubs/[slug]/reviews` aggregates event reviews
  whose event belongs to the club. Members-only. **No write path** — depends
  entirely on mechanism 1's rows.

### 3. Event survey — `EventSurvey` / `event_surveys` (133 rows) · ANONYMOUS
- **Prompt:** `/events/[id]/feedback` — "Anything feel off?" (→ moderator note) +
  "Would you return?" (+ optional venue stars). Hourly `sweep-event-surveys` cron
  notifies attendees ~24h after the event.
- **Anomaly → Report:** flagging "feel off" auto-files a `Report`
  (`reason: post_event_survey`) against the host and pings moderators
  (`/admin/moderation`, "✿ From surveys" filter). Reporter identity stays
  server-side.
- **Admin:** `/admin/feedback`, host-quality panel on `/admin/users/[id]`, and the
  quality card on `/admin`. Host sees their own would-return % via
  `HostProfileCard` — **anomalies deliberately hidden from the host** to protect
  anonymity.
- **Note:** `returnDeclineReason` column exists (added this session) but isn't
  collected yet — the paused "attribute the No" work fills it in.

### 4. Venue review — `BusinessReview` / `business_reviews` (5 rows) · PUBLIC, named
- **Prompts:** directory drawer/detail, the emerald `VenueReviewPrompt` dashboard
  card (added this session), and survey Q3. Weekly `sweep-review-nudges` cron.
- **Admin:** hide/unhide API exists but **has no UI caller**; `/admin/directory`
  handles *business reports*, not review moderation.

### 5. NPS — `MemberNPS` / `member_nps` (20 rows) · ANONYMOUS, product-wide
- **Prompt:** `/survey/nps`, 0–10, quarterly. Daily `sweep-nps` cron.
- **Admin:** `/admin/nps`. Fully anonymous.

### 6. Testimonials — `Testimonial` / `testimonials` · admin-authored marketing
- Not member feedback capture. `/admin/stories`. Leave entirely alone.

### Adjacent
- `Report` / `reports` (general reports + survey anomalies) → `/admin/moderation`.
- `BusinessReport` / `business_reports` (reports about venues) → `/admin/directory`.

---

## Recommended target state

**Member-facing — one prompt per target:**
- **After an event → ONE card.** Merge the `ReviewReminder` (public ★) and the
  survey notification into a single post-event flow, visibly sectioned:
  - _"Shared publicly, with your name"_ → ★ + text  → writes `Review`
  - _"Anonymous — the host never sees who"_ → would-return + feel-off + reason →
    writes `EventSurvey`
  One touchpoint, two records, honest about visibility.
- **Venue** and **NPS** prompts stay as-is (already one each).
- Fold the paused **decline-reason** into the anonymous section.

**Admin-facing — one hub:**
- A single **Feedback** page with tabs: **Events · Venues · NPS**, replacing the
  separate `/admin/feedback` and `/admin/nps` and giving event reviews a home
  they currently lack. Moderation stays separate (it's a safety/report workflow,
  not a metrics view).

**Explicitly NOT doing:** merging `reviews` into `event_surveys` (breaks
anonymity), or touching venue reviews / NPS / testimonials data models.

---

## Migration steps (phased, low-risk first)

### Phase 0 — decide (no code)
- Confirm the target above. Decide one open question: **should the public event ★
  and the anonymous would-return be two questions, or should would-return be
  derived from the ★?** Recommendation: keep them separate — a 5★ "loved it" and
  "would you come again" measure different things, and would-return must stay
  anonymous.

### Phase 1 — unify the member prompt (behavioural, reversible)
1. Extend `/events/[id]/feedback` to also collect the public ★ + text, in a
   clearly-labelled "public" section, writing a `Review` row via the existing
   review endpoint (reuse `POST /api/events/[id]/reviews`).
2. Point the post-event **notification + dashboard card** at this one page;
   retire the separate `ReviewReminder` → `/reviews` prompt (keep `/reviews` as
   an "edit my reviews" surface, just not a second nudge).
3. Add the `returnDeclineReason` picker (the paused work) to the anonymous
   section. Ship the already-written schema migration
   (`20260716000003_add_survey_decline_reason`) with it.
4. No data migration — both tables keep filling as before, just from one prompt.

### Phase 2 — unify the admin (additive)
5. Build the **Feedback** hub shell with three tabs; move the existing
   `/admin/feedback` and `/admin/nps` views under it unchanged.
6. Add an **Events** tab section that shows event `Review` aggregates
   (avg ★, recent, per-host) — the surface they lack today.
7. Redirect the old routes to the hub tabs; update `Sidebar.tsx`.

### Phase 3 — polish (optional)
8. Wire the orphaned venue-review hide API to a button in the Venues tab.
9. Reduce dashboard clutter: show at most **one** review card at a time
   (event *or* venue), not both — pick by recency.
10. Retire `/reviews` as a prompt entirely if the merged card covers it.

### Data safety
- Phases 1–2 are additive/behavioural — **no destructive data migration**, so no
  backfill risk. The only schema change is the already-written nullable
  `returnDeclineReason` column.
- Every phase is independently shippable and reversible.

---

## What this fixes
- **Member:** one post-event ask instead of two look-alike cards; clear about
  what's public vs anonymous.
- **Admin:** one Feedback hub instead of `/admin/feedback` + `/admin/nps` +
  event-reviews-nowhere + directory-review-hide-with-no-UI.
- **Preserves:** the anonymity wedge (safety flagging), public social proof
  (club reputation, wall), and host-quality metrics — none of which survive a
  naive table merge.
