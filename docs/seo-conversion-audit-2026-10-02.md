# Smileys website audit — SEO, UX, content, conversion (2026-10-02)

**Method.** Live crawl of https://smileyscommunity.com on 2026-10-02 (all 770 sitemap URLs fetched and parsed: status, title, description, canonical, robots, JSON-LD, h1, images), plus targeted reads of the event, club, post, handbook and policy pages, redirect probes, one mobile render, and the repo for the sitemap/club-page code. **Not verified** (no access): Search Console, real Core Web Vitals (CrUX/Lighthouse), prod DB counts. Where a claim needs those, it says so.

**Headline.** The pasted brief assumes several problems that are already solved (event schema, OG, lazy-loaded responsive images, public event pages, a separate Handbook section, "free to join" copy). The real problems are different and more specific: 135 thin club URLs in the sitemap, a homepage title with no searchable words, duplicate evergreen content split across `/posts` and `/handbook`, contradictory counters, and a 3-hop redirect on the root URL.

---

## What the brief assumed vs. what is actually live

| Brief's assumption | Verdict | Evidence |
|---|---|---|
| Event pages hidden behind login | **Wrong** | All 43 event pages are 200 to logged-out visitors with title, date, neighbourhood, price, "Good to know", description, host first name, OG image, canonical, and `Event` JSON-LD. |
| No Event schema / weak OG | **Mostly wrong** | `Event` on 43/43; OG image set on 770/770 pages; canonical on 635/770 (the 135 misses are all club pages). |
| Handbook buried in `/app/posts/` | **Partly wrong** | Handbook has its own section `/app/handbook/*` (26 `Article`-schema pages, quick-reference, stage and category pages, per-city). `/app/posts` holds 34 older stories — and *those* are where the duplicated evergreen content lives. |
| Images unoptimised | **Wrong** | `next/image` with srcset, `loading="lazy"` on 15/17 homepage images (the 2 hero images are `fetchpriority=high`), served as WebP. Empty `alt=""` on cover thumbnails is the only real gap. |
| Pricing may imply a subscription | **Mostly handled** | Under the hero CTA: "Free to join · Applications reviewed by hand within 24–48 hours · Pay only for events you attend", and a "How membership works" block: "No subscription, no membership fee." Residual issue is placement/wording (below). |
| Two no-show articles contradict each other | **No — duplicate, not contradictory** | Both state identical rules (10:00 next-morning message, 24 h cancel line, 3 h late-take exemption, 30-day window, 48 h "Still coming?", yellow/red cards). The real contradiction is elsewhere (see Critical #4). |

---

## Critical — fix immediately

### C1. 135 club pages in the sitemap are empty shells to Google
- **Problem:** `/app/clubs/<slug>` is members-only; the `(member)` layout redirects client-side, so a crawler gets HTTP 200 with only header/footer.
- **Evidence:** 135 of 136 `/clubs/*` URLs have **no `<h1>`, no canonical**, and the page body is the generic "Istanbul's curated social community — Find your people in Istanbul" banner — including on `clubs/newcomers-bursa` ("New in Bursa"), which tells Google a Bursa club is an Istanbul page. `app/sitemap.ts:248-254` emits all of them at priority 0.7. That is 18% of the sitemap pointing at near-duplicate soft-404s, which drags down site-quality signals for the real pages.
- **Change:** remove `clubRoutes` from the sitemap and add `robots: { index: false, follow: true }` to the club `generateMetadata` for logged-out requests (or return a proper guest preview — club name, description, next event, "Apply to join" — if you want them to rank; the per-city `/[city]/clubs` hubs already cover discovery). Keep `/[city]/clubs` in the sitemap.
- **Benefit:** removes ~135 low-quality URLs, stops wrong-city signals. **Difficulty:** Low.

### C2. Homepage title/description contain no searchable words
- **Evidence:** `<title>Smileys — your people, in every city you land in</title>`; description "Meet people, join clubs and discover experiences wherever your international…". No "expat", "events", "Istanbul", "community", "international". H1 is the same slogan. The homepage can only rank for the brand name.
- **Change (example):**
  - Title: `Smileys — Expat & International Community in Istanbul | Events, Clubs, Friends` (≤ 60 chars, e.g. `Expat Community & Events in Istanbul — Smileys`)
  - Description: `Meet people in Istanbul: free-to-join international community with weekly events, 100+ clubs and local hosts. Expats, nomads, students and locals. Apply in 5 minutes.`
  - Keep the slogan as the H1 but add a one-line eyebrow/subhead that names who and what: "A curated community for expats, nomads, students and locals — real events, real people, free to join."
- **Benefit:** the only page that can rank for "expat community Istanbul" / "meet people in Istanbul" finally states it. **Difficulty:** Low.

### C3. Root URL redirect chain: 3 hops
- **Evidence:** `http://smileyscommunity.com/` → 301 `https://smileyscommunity.com/` → 301 `/app/` → 301 `/app`. Single most-linked URL, with two avoidable hops. `/app/` and `/app` both resolve; same for `/app/events/` (200, no redirect to the canonical non-slash).
- **Change:** nginx: `location = / { return 301 https://smileyscommunity.com/app; }` (do the http→https and root→/app in one hop), and normalise trailing slashes with a single 301 (or rely on canonical, which is already correct).
- **Difficulty:** Low (server config; coordinate with Nate, not part of `deploy.sh`).

### C4. Event-page rules contradict the canonical no-show policy
- **Evidence:** the Blood on the Clocktower event (`/app/events/cmun4zqve002vls6fhglfk6r9`) carries host-written text "Please cancel within 12 hours for us to help count numbers" while the policy pages say the penalty line is **24 hours** (and "Still coming?" at 48 h). A member following the event page would cancel at 18 h and be recorded.
- **Change:** a standard, system-rendered "Attendance" block on every limited event (generated from the policy constants), and ask hosts to stop writing their own cancel rules; sweep existing event descriptions for "hours" patterns. Also confirm with Nate that the "cards" language in both articles matches live behaviour (project memory says v1 cards were reversed and v2 is planned) — I did not verify prod behaviour.
- **Benefit:** trust + fewer disputes. **Difficulty:** Low–Medium.

### C5. Member/event/club counters disagree across pages
- **Evidence (all live today):** homepage Istanbul card **1,528 members**, **116 clubs**, **42 upcoming**; the "Happening" filter says **43** events; footer/Why/Apply/About: **1,500+ members**, **170+ clubs ("across all cities")**, **"1,000+ events since our first in 2023"**; `/advertise`: **"Events on Smileys 300+"**; club list shows **"Social Istanbul 1851 members"** — more than the whole community; `/about`: "more than 100 countries" vs `/advertise`: "100+ nationalities". The footer strip is hand-typed CMS text (not in the repo — server `content.json`); the Istanbul card is measured.
- **Change:** one `getPublicStats()` (members, events-ever, clubs, nationalities) computed server-side, cached an hour, rounded down to a display value ("1,500+" only when ≥1,500), used by footer, About, Why, Apply, Advertise and the city card. Pick one definition for events (hosted-ever vs upcoming) and label them differently. Investigate the 1,851 club figure (likely counts pending/ex-members or double-counts) before it's visible to advertisers.
- **Benefit:** credibility; advertisers will notice 300 vs 1,000. **Difficulty:** Medium.

---

## High impact — next 30 days

### H1. Consolidate duplicated evergreen content (`/posts` vs `/handbook`)
- **Evidence (same intent, two indexed URLs each):** banking (`/posts/banking-money-in-istanbul…` vs `/handbook/opening-turkish-bank-account`); healthcare (`/posts/healthcare-in-istanbul-what-expats…` vs `/handbook/healthcare-in-istanbul-how-the-system-works`); getting around (`/posts/getting-around-istanbul…` vs `/handbook/istanbulkart-mastery`); apartments (`/posts/finding-an-apartment…` vs `/handbook/istanbul-apartment-hunting-guide` vs `/handbook/moving-into-a-flat…`); safety (`/posts/safety-in-istanbul…` vs `/handbook/scams-tourist-traps…`); Erasmus (3 posts + `student-istanbulkart`); plus overlapping "first 30 days", "thinking about moving", "living in Istanbul pros/cons". I judged these from titles/topics; **read each pair before merging** — the posts may carry unique value.
- **Change:** one winner per intent, merged into `/handbook/…`, loser 301'd to winner (Next `redirects()` in `next.config.js` or a DB `redirectFrom` on Post). Keep posts only for time-bound stories (city launches, Smileys Cup recap, interviews).
- **Benefit:** ends cannibalisation, concentrates links. **Difficulty:** Medium.

### H2. Add `Article` + `BreadcrumbList` schema to posts, guide and handbook
- **Evidence:** `Article` exists on 26 handbook pages only; 34 posts and 118 guide entries carry just `Organization`; breadcrumbs only on city and neighbourhood pages (190/190 neighbourhood pages already have `BreadcrumbList` + `Place`).
- **Change:** shared `articleJsonLd()` (headline, image, datePublished/dateModified from `reviewedAt` where honest, author = `Organization` Smileys or the byline, publisher) and breadcrumb `Home › Istanbul › Handbook › Banking`. Guide entries: `TouristAttraction`/`Place` with `geo` where coordinates exist. Escape `<` in JSON-LD (project rule).
- **Difficulty:** Low–Medium.

### H3. Make event schema Google-valid and honest
- **Evidence:** 43/43 events: `location.address.streetAddress` is empty; `location.name` is the neighbourhood ("Kadıköy"), not a venue; `endDate` on only 19/43; `organizer` always "Smileys Community"; `offers.availability` is `InStock` for 42 even when the event shows "Only 2 left"/full (1 `SoldOut`); no `validFrom`; `image` is a string not an array.
- **Change:** keep venue/address members-only (privacy rule) but then omit `streetAddress` rather than emit "" and use `location: {"@type":"Place","name":"Kadıköy, Istanbul","address":{"addressLocality":"Kadıköy","addressRegion":"Istanbul","addressCountry":"TR"}}`; add `endDate` (default start + 2 h flagged as estimate, or omit), `offers.availability` = `LimitedAvailability` when ≤ 20% left and `SoldOut` when full, `isAccessibleForFree`, and `organizer` = Smileys (keep host first name only in the page body, per guest rule). For paid events add `offers.priceCurrency: TRY` (already) — do **not** put € in schema.
- **Benefit:** eligibility for event rich results without exposing members-only data. **Difficulty:** Low.

### H4. Event meta descriptions lead with emoji and a date, not a reason to click
- **Evidence:** `📅 Friday, November 20 · 18:30 · Kadıköy — 🕰️👹 Welcome to Ravenswood Bluff 🌙 A te…`; 234 of 770 titles contain emoji; 126 titles exceed 65 chars.
- **Change:** event title template `Blood on the Clocktower — Fri 20 Nov, Kadıköy | Free | Smileys Istanbul`; description `Free social game night in Kadıköy on Fri 20 Nov, 18:30. English-speaking, up to 19 people. Small curated group — apply to Smileys to RSVP.` Strip emoji from `<title>` and description (keep in body). Clamp to 60/155.
- **Difficulty:** Low.

### H5. Events hub for "this weekend / this week"
- **Evidence:** `/app/events?date=this-weekend` returns the same page, canonical `/app/events`, same title; a query string cannot rank. The page is a good `ItemList` already.
- **Change:** real routes `/app/istanbul/events/this-weekend`, `/this-week`, `/today`, plus category routes (`/language-exchange`, `/dinners`, `/social-games`) rendered server-side from the existing queries, each with unique H1/title/intro, `ItemList` schema, canonical to itself, noindex when empty. Realistic expectation: these can rank for long-tail ("language exchange Istanbul", "expat events Istanbul"), not for the head term "events in Istanbul this weekend", which Biletix/Eventbrite/TimeOut dominate; the win is the *expat/international* angle.
- **Difficulty:** Medium.

### H6. Hero says what + who + free; put real people on first screen
- **Evidence (10-second test, mobile 375×812):** above the fold: pill "Live in Istanbul · 6 founding · 4 coming soon" (internal jargon), H1 "Your people, in every city you land in.", a composite skyline illustration (Istanbul/London/Dubai — no real people, looks generated), two CTAs. "Free to join · … · Pay only for events you attend" sits just below the fold. Answer: a visitor learns it's about "people" and cities, **not** that it's events/clubs, **not** that it is for expats/nomads/students, and not that it's free until scrolling. Testimonials and host faces appear only far down the page; the first real event card is below the city pills.
- **Change:** see copy below. Replace hero art with a real event photo (consent-checked) or a 3-photo strip; move the free line up to sit directly under the CTAs; move one testimonial + "Hosted by Nate, City Lead" next to the CTA; rename the pill to `Istanbul is open · 6 more cities starting`. Note: project memory says a "composite hero photo" was already an open item, and Nate prefers the amber-500 button — don't recolour.
- **Difficulty:** Low–Medium.

### H7. Pricing language
- **Evidence:** "Pay only for events you attend" is fine, but 15 of 43 upcoming events are paid (28 free): ₺250–₺1,290; 7 at ₺1,200 (sailing). So "Most of our events are free" is true by count but a first-time sailing-curious visitor meets ₺1,200 with no context.
- **Change:** (a) rewrite the hero microcopy (below); (b) one "What events cost" line on `/events` and `/apply`: "Joining is free. About two-thirds of events are free; the rest cover a venue or activity — typically ₺250–₺1,300 (≈ €5–€27), shown before you RSVP." Source the ranges from the data so it stays true.
- **FX recommendation:** show approximate €/$ **only as display text**, never in schema: `₺1,200 ≈ €25`, rounded to the nearest €1/€5, computed server-side from one cached daily rate (Frankfurter/ECB, 24 h cache, fall back to hiding the € text if the fetch fails). Risks are real (TRY inflation → a hard-coded table goes stale in weeks; a wrong € figure is a trust problem), so label with "≈" and "at today's rate", and don't promote it to an "official" price. Cheapest 80% solution: just the range sentence above, updated quarterly.
- **Difficulty:** Low (copy) / Medium (FX).

---

## Medium — next 90 days

1. **City-first URL strategy.** Do **not** try to drop `/app` (basePath, cookie path, PWA scope and OG routes all assume it; high risk for little gain — Google ranks `/app/...` fine). Instead make `/app/istanbul/*` the SEO spine: `/app/istanbul/handbook`, `/app/istanbul/guide`, `/app/istanbul/neighborhoods` already exist for other cities (`/bursa/handbook` etc.); Istanbul still uses the unprefixed `/app/handbook`, `/app/guide`, `/app/neighborhoods` and `/app/events`. Pick the city-prefixed form as canonical (matching the other six cities), 301 the old ones. Nginx already 301s any root path `/x` → `/app/x`, so external links to `/handbook` keep working; don't introduce `/istanbul-handbook` as a second system.
2. **Neighbourhood hub as the long-tail engine.** 190 pages with `Place` + `BreadcrumbList` is the strongest asset; add "events this week in <hood>" and a short human intro (many may be template text — spot-check). Per-city `?city=` pages (`/neighborhoods/heykel?city=bursa`) work but a query string is an odd canonical for a different city; migrate to `/app/<city>/neighborhoods/<slug>`.
3. **Duplicate titles:** six city marketplaces all titled "Marketplace — Smileys Community"; "Coffee & Conversation" ×6, "Women" ×2 — add city to the title (`Marketplace in Izmir — Smileys`).
4. **Missing hub/gap content** (verify volumes in Search Console/Ahrefs before commissioning; I did not have keyword data): "language exchange Istanbul" (club pages exist but are noindexed-in-effect, see C1), "expat events Istanbul" landing, "digital nomad Istanbul" (a remote-work hub exists at `/[city]/remote-work`; link it from the Handbook nomad-visa article), "things to do in Istanbul this week", cost of living (currently a post), "coworking in Istanbul", a Turkish-residence-permit pillar linking the satellites (SIM, tax number, e-Devlet, insurance, bank).
5. **Internal linking.** Handbook articles should link to each other and to the matching event/club ("meet people who've done this" CTA); post → handbook, handbook → city hub; add "Related" blocks and breadcrumbs.
6. **Turkish/hreflang.** No Turkish pages and no hreflang. Don't build `/tr` yet: the target queries are English, and hreflang without translations does nothing. Revisit when you have capacity to translate the ten highest-traffic Handbook articles properly (hreflang pairs + `x-default`).
7. **Past-event behaviour.** Sitemap holds only future events (43; earliest today). Check what a past event URL returns (should be 200 with `EventStatus` + "this event has passed" and a link to the next similar one, not a 404 that loses links).
8. **Hosts & people.** `/hosts`, `/istanbul` host rails exist with first-name-only guest rule; add host photos where members consented, event photo galleries on city/club pages for guests, and a short "who comes" nationality strip (measured, not claimed).

---

## Nice to have
- `alt` text on cover thumbnails (handbook cards 26/27 and posts 32/32 are `alt=""` — valid for decorative images but the covers are meaningful; use the title or a real description).
- Remove emoji from `<title>` site-wide (already in H4 for events).
- `llms.txt` (`/llms.txt` currently just 301s into `/app/…`; not checked beyond that) if you care about AI discovery.
- Sticky "Apply" bar after the hero on mobile; shorter `Visiting` sub-flow.
- `WebSite` `SearchAction` only if the site gets a public search page.
- FAQPage on city pages already exists (6 cities + Istanbul); keep answers matching the live FAQ text.

---

## The seven proposed quick wins — verdicts

| # | Proposal | Verdict |
|---|---|---|
| 1 | Make important event info public without login | **Already done.** Name, date/time, neighbourhood, price, language, group size, description, first-name host, image are public; venue address and attendee lists are correctly members-only. Keep it that way — do not expose exact venue to guests. Only fix: remaining-spots honesty (H3). |
| 2 | One authoritative member count everywhere | **Justified, high priority** (C5). |
| 3 | Add Event schema and strong OG to event pages | **Already done; refine, don't add** (H3, H4). |
| 4 | Separate SEO Handbook from application routes | **Mostly done** (`/app/handbook`). The real task is merging duplicated `/posts` content into it with 301s (H1) and standardising Istanbul on city-prefixed URLs (Medium #1). Moving out of `/app` entirely is **not recommended**. |
| 5 | Improve Apply CTA + nearby social proof | **Justified.** Copy is already decent; the gap is proof *near* the button (H6). |
| 6 | Compress/lazy-load images + alt text | **Mostly unnecessary.** Already WebP/srcset/lazy with a priority hero. Only alt text on cover thumbnails (Nice to have). Verify CWV in PageSpeed/CrUX before spending time — TTFB measured 0.24–0.27 s, HTML 25–46 KB gzipped, which is healthy. |
| 7 | Consolidate no-show policy to one source | **Justified, but for different reasons**: not contradictory, ~85% duplicated; and the real conflict is host-written cancel rules on event pages (C4). Structure below. |

### Recommended no-show structure
- **One canonical member policy** (the existing "How free-event spots work, and what counts as a no-show"): move to a stable help URL (`/app/guidelines/attendance` or `/app/standing`) and 301 the post to it. Keep it indexable — transparency builds trust.
- **Host guide** shrinks to the host's three actions (scan everyone, check the list next morning, be generous) plus a link to the canonical policy; move it to the host area (`/app/host/…`) instead of public `/posts`, and 301/410 the post. It shouldn't be a public search result.
- Generate the numbers (24 h, 48 h, 3 h, 30 days, 10:00) from one constants file so the pages and the event-page block (C4) cannot drift.

---

## 30-day plan (implementation order)

1. **Remove club URLs from sitemap + noindex logged-out club pages** (C1) — 1 hour.
2. **Fix nginx root redirect chain** (C3) — 15 min, needs server access.
3. **Homepage title/description/eyebrow rewrite** (C2) — copy below.
4. **`getPublicStats()` single source** and replace footer/About/Why/Apply/Advertise/city card (C5); investigate the 1,851 figure.
5. **Event title/description templates (no emoji, clamp)** (H4).
6. **Event JSON-LD fixes** — omit empty address, availability by remaining spots, `endDate` (H3).
7. **Attendance block on event pages + sweep the 12-hour text** (C4).
8. **Hero: free line up, proof + host next to CTA, real photo** (H6).
9. **"What events cost" line + price range from data** (H7); decide on the € display.
10. **Merge duplicate post/handbook pairs with 301s** — start with banking, healthcare, apartments (H1).
11. **`Article` + `BreadcrumbList` schema for posts, handbook and guide** (H2).
12. **Consolidate the no-show docs; move host guide to host area** (see structure above).
13. **`/istanbul/events/this-weekend`, `/this-week` landing routes** (H5).
14. **City names in duplicate titles** (marketplace, clubs) (Medium #3).
15. **Search Console + CWV pass**: submit the cleaned sitemap, check Coverage for "Crawled – currently not indexed" on club/guide URLs, and re-measure.

---

## Examples

**Homepage.**
- Title: `Expat Community & Events in Istanbul — Smileys`
- Description: `Meet people in Istanbul. Free-to-join international community with weekly events, clubs and local hosts — for expats, nomads, students and locals. Apply in 5 minutes.`
- Hero H1: `Your people, in every city you land in.` — Subhead: `A curated community for expats, nomads, students and locals. Join free, then come to real events — dinners, sailing, language nights, hikes.`
- Primary CTA: `Apply to join — it's free` · Secondary: `See this week's events` · Microcopy (under buttons, not below the fold): `No membership fee. Applications reviewed by hand in 24–48 hours. Many events are free; some cover a venue or activity (₺250–₺1,300).`
- Proof next to CTA: `"I felt like I was among sisters rather than strangers." — Sara K., member since 2023` + three small member photos + `Hosted by Nate, City Lead`.

**Event page structure** (guest view): H1 title · date/time · neighbourhood · `Free` or `₺1,200 (≈ €25) · pay in advance` · host first name + "Hosted by" photo if consented · 2-sentence summary · what to expect · **Attendance rules (system block)** · `Apply to RSVP` / `Sign in to RSVP` · "More like this" (same category, next 3).

**Event schema (illustrative):**
```json
{"@context":"https://schema.org","@type":"Event","name":"Blood on the Clocktower",
 "startDate":"2026-11-20T18:30:00+03:00","endDate":"2026-11-20T21:30:00+03:00",
 "eventStatus":"https://schema.org/EventScheduled",
 "eventAttendanceMode":"https://schema.org/OfflineEventAttendanceMode",
 "location":{"@type":"Place","name":"Kadıköy, Istanbul",
   "address":{"@type":"PostalAddress","addressLocality":"Kadıköy","addressRegion":"Istanbul","addressCountry":"TR"}},
 "image":["https://smileyscommunity.com/app/api/files/events/….jpg?w=1200"],
 "isAccessibleForFree":true,
 "offers":{"@type":"Offer","price":"0","priceCurrency":"TRY","availability":"https://schema.org/LimitedAvailability","url":"…"},
 "organizer":{"@type":"Organization","name":"Smileys Community","url":"https://smileyscommunity.com/app"}}
```

**Redirects (H1/Medium #1)** — `next.config.js`:
```js
async redirects() {
  return [
    { source: '/posts/banking-money-in-istanbul-what-expats-need-to-know', destination: '/handbook/opening-turkish-bank-account', permanent: true },
    { source: '/posts/how-no-show-cards-work-for-hosts', destination: '/guidelines/attendance', permanent: true },
    // …one line per merged pair; keep for ≥ 12 months
  ]
}
```
(basePath `/app` is applied automatically.)

**Internal linking.** Each Handbook article: breadcrumb → "Related guides" (2–3) → "Meet people who've done this: <club/event>" → city hub. `/app/istanbul` links to `/events/this-weekend`, the six pillar Handbook articles, and the nomad/student/visiting hubs.

---

## Open questions for Nate
- Are the "cards" in both attendance articles current behaviour? (Memory says v1 cards were reversed.)
- Should club pages stay members-only (→ noindex, my default) or get a public preview to rank for "language exchange Istanbul"?
- OK to touch the nginx root redirect (C3)? Nothing in this audit was deployed or changed in prod.
