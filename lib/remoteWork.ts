import { canonicalCategory } from './handbook-categories'
import { safeTz, shiftDay } from './cityTime'
import { isOffCalendar } from '@/lib/eventJoinState'
import { DEFAULT_CITY_SLUG } from './city'

// The remote-work hub (/[city]/remote-work) assembles pages that already
// exist — Handbook articles, clubs, events — into one arrival path. It adds no
// content of its own, and the rules for what it may show live here so they can
// be tested without a database:
//
//   · a topic appears only if the city's Handbook has an article for it, and
//     links only to that article — no topic is promised on the page and then
//     turns out to be empty on click
//   · "workspace" clubs are matched on their names, because nothing in the
//     schema marks a club as work-related; a city whose clubs don't match
//     simply shows no workspace section
//   · the time-zone line is computed from the city row, never typed

/** The Handbook topics a remote worker needs in the first days, in the order
 *  they come up. `category` is a canonical Handbook category key. `keywords`
 *  says which articles in a broad category are on-topic ('Mobile & Digital'
 *  also holds e-Devlet, 'Home & Housing' the daily-life piece): the lead slot
 *  falls back to the category's best, but the second slot only takes an
 *  on-topic article. `lead` picks which on-topic article opens the topic —
 *  the one the checklist links — when several match (a bank account before
 *  the tax number it needs). */
export const REMOTE_WORK_TOPICS = [
  { key: 'connect',   title: 'SIM, eSIM and home internet', category: 'Mobile & Digital',  keywords: /sim|internet|mobile|esim|phone/i },
  { key: 'housing',   title: 'Housing and neighborhoods',  category: 'Home & Housing',    keywords: /apartment|rent|hous|home|flat/i, lead: /rent/i },
  { key: 'money',     title: 'Banking and money',           category: 'Money & Banking',   keywords: /bank|money|card|tax/i, lead: /bank/i },
  { key: 'transport', title: 'Getting around',              category: 'Getting Around',    keywords: /card|metro|bus|ferr|transport|kart|airport|arriv|havaliman/i },
  { key: 'legal',     title: 'Visas and residence',         category: 'Residence & Legal', keywords: /residence|permit|visa|ikamet|i̇kamet/i },
  // Last: it matters once a stay turns into a residence permit, which needs insurance.
  { key: 'health',    title: 'Health and insurance',        category: 'Healthcare',        keywords: /health|insurance|sigorta|hospital|doctor|pharma|sgk|gss/i },
] as const

export type RemoteWorkTopicKey = (typeof REMOTE_WORK_TOPICS)[number]['key']

export interface HubArticle {
  slug:           string
  title:          string
  excerpt:        string | null
  category:       string
  cityId:         string | null
  lastReviewedAt: Date | string | null
  reviewIntervalDays?: number | null
  hasOfficialSources: boolean
}

export interface HubTopic<A extends HubArticle = HubArticle> {
  key:      RemoteWorkTopicKey
  title:    string
  articles: A[]
}

/** How many articles one topic lists. Two is enough to offer a city-local
 *  guide beside the national one without turning a topic into a shelf. */
export const ARTICLES_PER_TOPIC = 2

/**
 * Group the city's Handbook articles into the hub's topics. Articles arrive
 * already scoped to the city (lib/postScope); topics with nothing to link are
 * dropped rather than rendered empty.
 *
 * Inside a topic: keyword matches first, then this city's own articles ahead
 * of national ones (a city guide is the more specific answer), input order
 * otherwise.
 */
export function groupHubArticles<A extends HubArticle>(articles: A[], cityId: string): HubTopic<A>[] {
  return REMOTE_WORK_TOPICS.flatMap(topic => {
    const inCategory = articles.filter(a => canonicalCategory(a.category) === topic.category)
    if (inCategory.length === 0) return []
    const text    = (a: A) => `${a.title} ${a.slug}`
    const onTopic = (a: A) => topic.keywords.test(text(a))
    const lead    = 'lead' in topic ? topic.lead : null
    const score = (a: A) =>
      (onTopic(a) ? 2 : 0) + (onTopic(a) && lead?.test(text(a)) ? 4 : 0) + (a.cityId === cityId ? 1 : 0)
    const ranked = inCategory
      .map((a, i) => ({ a, i, s: score(a) }))
      .sort((x, y) => y.s - x.s || x.i - y.i)
      .map(x => x.a)
    // The lead is the category's best even when nothing matches; the rest
    // must be on-topic — e-Devlet is not a SIM guide.
    const [first, ...rest] = ranked
    const picked = [first, ...rest.filter(onTopic)].slice(0, ARTICLES_PER_TOPIC)
    return [{ key: topic.key, title: topic.title, articles: picked }]
  })
}

/** Club names that mean "people who work from here". Matched on the name
 *  because clubs carry no work flag; Newcomers is included on purpose — it is
 *  the other door a solo arrival walks through. */
export const WORK_CLUB_PATTERN = /cowork|co-work|remote|nomad|newcomer/i

export function isWorkClub(name: string): boolean {
  return WORK_CLUB_PATTERN.test(name)
}

// ── "Working from …" interviews ─────────────────────────────────────────────
//
// One member a month answers the same seven questions about working from
// this city, and the piece ends with the coworking session they will be at —
// the read is meant to turn into a meeting. It is an ordinary community post
// (app/admin/posts/constants) so it needs no model of its own, and the hub
// shows the newest one. Two rules, both tested:
//
//   · the interview must be pinned to THIS city. An interview with no
//     cityId, or another city's, is not "a remote worker in İzmir", so the
//     loader filters on cityId rather than the listing scope every other
//     story read uses (lib/postScope) — no global fallback fills the card
//   · who it is "by" is decided per request, never inside the cached loader:
//     the loader returns the author's id only, the page projects the byline
//     through lib/storyByline like every other story surface (a guest gets a
//     first name and no photo; a connections-only member is hidden)

/** The community-post category the series is published under. */
export const INTERVIEW_CATEGORY = 'Working from'

/** The hub's article shelf — remote-work and nomad pieces, newest first.
 *  Not the interview's category: the hub shows one interview as a card, and
 *  articles as a list; one category could not tell them apart. */
export const NOMAD_STORY_CATEGORY = 'Digital nomads'
/** How many the shelf lists — two rows of three. */
export const NOMAD_STORY_LIMIT = 6

/**
 * Which nomad stories a city's shelf shows: its own, and every story pinned
 * to no city — unless that story is limited to another country (the admin
 * form's "Applies in"). Unlike the interview, a nomad piece is usually advice
 * that holds anywhere ("your first remote job"), and both early stories were
 * saved with "No single city" — so city-only left the shelf empty
 * (2026-10-06). A story pinned to one city still shows only there.
 */
export function nomadStoryScope(cityId: string, country: string | null) {
  return {
    OR: [
      { cityId },
      { cityId: null, OR: [{ country: null }, ...(country ? [{ country }] : [])] },
    ],
  }
}

/** The contact-form topic a nomination arrives as (app/api/contact). */
export const NOMINATE_TOPIC = 'nominate'

/** Where a member goes to nominate the next interviewee: the contact form,
 *  pre-set to the nomination topic and naming the city (its display name —
 *  the form quotes it in the seeded message). Members only on the page: a
 *  nomination is a member vouching for another member. */
export function nominateHref(cityName: string): string {
  return `/contact?topic=${NOMINATE_TOPIC}&city=${encodeURIComponent(cityName)}`
}

/** An event as the hub's picker needs it: enough to tell a weekly session
 *  from a one-off and a coworking session from a newcomer event. */
export interface HubEventLike {
  id:                   string
  date:                 string
  title:                string
  time?:                string | null
  clubId?:              string | null
  seriesId?:            string | null
  isFirstTimerFriendly?: boolean
  status?:              string
}

/** Most coworking sessions the "work and meet people" row shows, so that
 *  first-timer-friendly events always get the rest of it. */
export const HUB_WORK_EVENT_CAP = 3

/**
 * The hub's events row, from the city's upcoming events (soonest first).
 *
 * A weekly session appears once, as its next date — six cards that were
 * three sessions repeated said less than three. Coworking sessions (events
 * of a work club) take at most HUB_WORK_EVENT_CAP places and first-timer-
 * friendly events the rest, each backfilling the other when it runs short,
 * so neither kind can crowd the other out. Cancelled events never appear.
 * The result is back in date-and-time order.
 */
export function pickHubEvents<E extends HubEventLike>(events: E[], workClubIds: Set<string>, limit: number): E[] {
  const seen = new Set<string>()
  const once = events.filter(e => {
    if (isOffCalendar(e)) return false
    // A series is one session; an event with no series is its own.
    const key = e.seriesId ? `s:${e.seriesId}` : `e:${e.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const isWork  = (e: E) => !!e.clubId && workClubIds.has(e.clubId)
  const work    = once.filter(isWork)
  const newbies = once.filter(e => !isWork(e) && e.isFirstTimerFriendly)
  const workTake = Math.min(work.length, Math.max(HUB_WORK_EVENT_CAP, limit - newbies.length))
  const picked = [...work.slice(0, workTake), ...newbies.slice(0, limit - workTake)]
  // Date, then start time ('HH:MM', so it sorts as text): an 11:00 meetup
  // comes before a 12:00 session on the same day, whichever kind it is.
  return picked.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
}

/** Where a remote worker's employer most often is. A 9-to-5 in each is shown
 *  in the city's local hours; a zone on the city's own offset says nothing
 *  and is left out. */
export const HOME_ZONES = [
  { label: 'London',        tz: 'Europe/London' },
  { label: 'Berlin',        tz: 'Europe/Berlin' },
  { label: 'New York',      tz: 'America/New_York' },
  { label: 'San Francisco', tz: 'America/Los_Angeles' },
] as const

/** A zone's offset from UTC in minutes at `now` — DST included. */
export function offsetMinutes(tz: string, now: Date = new Date()): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find(p => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

const clock = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export interface WorkdayOverlap { label: string; start: string; end: string }

/**
 * A 09:00–17:00 day in each home zone, as the city's clock reads it right
 * now: what a remote worker actually needs to line up calls. Computed from
 * both zones' current offsets, so it is right on either side of each DST
 * change (which Europe and the US make on different weekends).
 */
export function workdayOverlap(cityTz: string, now: Date = new Date()): WorkdayOverlap[] {
  const here = offsetMinutes(cityTz, now)
  return HOME_ZONES.flatMap(({ label, tz }) => {
    const diff = here - offsetMinutes(tz, now)
    if (diff === 0) return []
    return [{ label, start: clock(9 * 60 + diff), end: clock(17 * 60 + diff) }]
  })
}

/** How many coworking sessions the next seven days hold (today included,
 *  in the city's own day), and where — every occurrence counted, so a weekly
 *  session twice in the window counts twice. Null when there are none: the
 *  line is only worth showing when it has something to say. */
export function coworkingWeek(sessions: { date: string; neighborhood?: string | null }[], today: string): { count: number; places: string[] } | null {
  const end = shiftDay(today, 6)
  const inWeek = sessions.filter(s => s.date >= today && s.date <= end).sort((a, b) => a.date.localeCompare(b.date))
  if (inWeek.length === 0) return null
  const places = [...new Set(inWeek.map(s => s.neighborhood?.trim()).filter((n): n is string => !!n))]
  return { count: inWeek.length, places }
}

/** The city's UTC offset right now, e.g. 'UTC+3' or 'UTC−4:30' — what a remote
 *  worker needs to line up calls with home. Computed from the zone, so DST
 *  cities read correctly in both halves of the year. */
export function utcOffsetLabel(tz: string, now: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find(p => p.type === 'timeZoneName')?.value ?? 'GMT'
  // 'GMT+3', 'GMT-4:30', or bare 'GMT' for zero offset.
  const offset = part.replace(/^GMT/, '')
  return offset ? `UTC${offset.replace('-', '−')}` : 'UTC±0'
}

/** One line of the first-72-hours checklist. `href` is null when the city has
 *  nothing to link for that step — the step still renders (it is still a
 *  thing to do) but says so instead of linking to an empty page. */
export interface ChecklistStep {
  key:    'connect' | 'neighborhood' | 'workspace' | 'money' | 'first-event'
  title:  string
  body:   string
  href:   string | null
  cta:    string
  /** Further pages for the same step, e.g. transport beside money. */
  more?:  { href: string; cta: string }[]
}

export interface ChecklistInput {
  citySlug:         string
  topics:           HubTopic[]
  hasNeighborhoods: boolean
  hasWorkClubs:     boolean
  // Upcoming events from those clubs — the only evidence that "members run
  // coworking sessions" is true this month rather than once upon a time.
  hasWorkEvents:    boolean
  // Whether those sessions are members-only — then the step says so, rather
  // than promise a desk to someone who can't book it yet.
  workMembersOnly?: boolean
  hasEvents:        boolean
}

// Article links keep the city (lib/cityPageParam's rule, inlined — that module
// reads the session): without ?city= an article opened from /antalya/remote-work
// showed Istanbul's breadcrumbs and related guides.
const articleHref = (slug: string, citySlug: string) =>
  `/handbook/${slug}${citySlug === DEFAULT_CITY_SLUG ? '' : `?city=${citySlug}`}`

const topicHref = (topics: HubTopic[], key: RemoteWorkTopicKey, citySlug: string) => {
  const first = topics.find(t => t.key === key)?.articles[0]
  return first ? articleHref(first.slug, citySlug) : null
}

/**
 * The first-72-hours path, each step pointing at the one page that answers
 * it in this city. Paths are basePath-relative (for next/link).
 */
export function buildChecklist({ citySlug, topics, hasNeighborhoods, hasWorkClubs, hasWorkEvents, workMembersOnly, hasEvents }: ChecklistInput): ChecklistStep[] {
  const moneyHref     = topicHref(topics, 'money', citySlug)
  const transportHref = topicHref(topics, 'transport', citySlug)
  // The city's airport-arrival guide, when its Handbook has one: getting in
  // from the airport is the first transport problem of the 72 hours.
  const airport = topics.find(t => t.key === 'transport')?.articles.find(a => /airport|arriv|havaliman/i.test(`${a.title} ${a.slug}`))
  const airportHref = airport ? articleHref(airport.slug, citySlug) : null
  // The transport card guide — the transport topic's lead that isn't the airport one.
  const cardArticle = topics.find(t => t.key === 'transport')?.articles.find(a => a !== airport)
  const cardHref = cardArticle ? articleHref(cardArticle.slug, citySlug) : null
  return [
    {
      key: 'connect',
      title: 'Get connected',
      body: 'Sort out a SIM or eSIM on day one, and home internet if you are staying a while.',
      href: topicHref(topics, 'connect', citySlug),
      cta:  'Read the SIM and internet guide',
    },
    {
      key: 'neighborhood',
      title: 'Choose a neighborhood',
      body: 'Where you stay decides your commute, your cafés and who is around in the evening.',
      href: hasNeighborhoods ? `/neighborhoods?city=${citySlug}` : topicHref(topics, 'housing', citySlug),
      cta:  'Compare neighborhoods',
    },
    {
      key: 'workspace',
      title: 'Find somewhere to work',
      body: hasWorkEvents
        ? (workMembersOnly
            ? 'Members run regular coworking sessions — a desk, some company, and people to have lunch with. They’re for members: joining is free, and applications are reviewed within 24–48 hours.'
            : 'Members run regular coworking sessions — a desk, some company, and people to have lunch with.')
        : hasWorkClubs
          ? 'Join a coworking or remote-work club to hear where members actually work from.'
          : 'Once you are in, ask members where they work from — there is no workspace list here yet.',
      // Straight to the session cards when there are sessions; the club
      // cards head the section, so its top would land on those instead.
      href: hasWorkEvents ? '#sessions' : hasWorkClubs ? '#work-and-meet' : null,
      cta:  hasWorkEvents ? 'See coworking sessions' : 'See the clubs',
    },
    {
      key: 'money',
      title: 'Sort money and transport',
      body: 'Getting in from the airport, how to pay, how to get a local account if you need one, and the card that gets you on transit.',
      href: moneyHref ?? cardHref ?? airportHref,
      cta:  moneyHref ? 'Read the money guide' : cardHref ? 'Read the transport guide' : 'From the airport',
      more: [
        ...(moneyHref && cardHref ? [{ href: cardHref, cta: 'Read the transport guide' }] : []),
        ...(airportHref && (moneyHref || cardHref) ? [{ href: airportHref, cta: 'From the airport into the city' }] : []),
      ],
    },
    {
      key: 'first-event',
      title: 'Join a first event',
      body: 'Pick something marked first-timer friendly, or a coworking session, and show up.',
      href: hasEvents ? '#sessions' : `/${citySlug}/events`,
      cta:  'See upcoming events',
    },
  ]
}
