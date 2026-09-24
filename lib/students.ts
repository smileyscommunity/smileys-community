import { pickArticle, ENTRY_RULES, type StageArticle } from './relocation'
import { DEFAULT_CITY_SLUG } from './city'

// The student hub (/[city]/students) — for Erasmus, exchange and international
// students arriving for a semester or a year. Like the remote-work and moving
// hubs it writes no content of its own: every link lands on a page the city
// already has (a Handbook article, a Guide audience, an event, a club), and
// the rules for what may show live here so they are tested, not eyeballed:
//
//   · a guide link appears only if the city's Handbook has that article
//   · an event filter is offered only when at least one upcoming event
//     matches it — no "language exchange" chip that opens an empty list
//   · nothing about students is invented: no discounts, no university
//     partnerships, no "solo-friendly" flag (the data has none — the
//     first-timer flag is the curated "easy to come to alone" signal)
//   · nightlife is one thing among many, never the shelf

/** The Handbook questions a student has in the first weeks, in the order
 *  they come up. Each is found by what the article is about (lib/relocation
 *  pickArticle), so a renamed slug or another city's version still resolves. */
export const STUDENT_GUIDES = [
  { key: 'entry',     label: 'Entry rules and how long you can stay', category: 'Residence & Legal',    about: ENTRY_RULES },
  // "residence"/"ikamet" only: a bare "permit" also matches the remote-work
  // guide's "Work Permissions".
  { key: 'residence', label: 'How residence permits work',            category: 'Residence & Legal',    about: /residence|ikamet|i̇kamet/i },
  { key: 'connect',   label: 'SIM, eSIM and mobile internet',         category: 'Mobile & Digital',     about: /\bsim\b|internet|esim|mobile/i },
  { key: 'transport', label: 'Transport card and getting around',     category: 'Getting Around',       about: /kart|card|metro|transport|ferr/i },
  { key: 'airport',   label: 'From the airport into the city',        category: 'Getting Around',       about: /airport|arriv|havaliman/i },
  { key: 'money',     label: 'Money and bank accounts',               category: 'Money & Banking',      about: /bank|money/i },
  { key: 'housing',   label: 'Renting a flat',                        category: 'Home & Housing',       about: /apartment|rent|hous|flat/i },
  { key: 'safety',    label: 'Scams and staying safe',                category: 'Safety & Emergencies', about: /scam|safe/i },
  { key: 'emergency', label: 'Emergency numbers',                     category: 'Safety & Emergencies', about: /emergenc|\b112\b/i },
  { key: 'health',    label: 'How healthcare works',                  category: 'Healthcare',           about: /health|doctor|hospital/i },
] as const

export type StudentGuideKey = (typeof STUDENT_GUIDES)[number]['key']

export interface StudentGuide<A extends StageArticle> {
  key:     StudentGuideKey
  label:   string
  article: A
}

/** The city's article for each student question, in STUDENT_GUIDES order.
 *  A question the city has no article for is left out, and one article never
 *  answers two questions (the transport card guide is not also the airport
 *  guide). */
export function studentGuides<A extends StageArticle>(articles: A[], cityId: string): StudentGuide<A>[] {
  const used = new Set<string>()
  const out: StudentGuide<A>[] = []
  // The airport guide is picked before the transport card so the broader
  // transport pattern ("transport", "metro") can't claim it first.
  const order: StudentGuideKey[] = ['entry', 'residence', 'connect', 'airport', 'transport', 'money', 'housing', 'emergency', 'safety', 'health']
  const picked = new Map<StudentGuideKey, A>()
  for (const key of order) {
    const g = STUDENT_GUIDES.find(x => x.key === key)!
    const a = pickArticle(articles.filter(x => !used.has(x.slug)), g.category, g.about, cityId)
    if (!a) continue
    used.add(a.slug)
    picked.set(key, a)
  }
  for (const g of STUDENT_GUIDES) {
    const a = picked.get(g.key)
    if (a) out.push({ key: g.key, label: g.label, article: a })
  }
  return out
}

/** The Guide audiences (lib/guide audiencesFor) the hub offers, in this
 *  order: culture and daytime first, nightlife last — a student is not only a
 *  night out. Only those the city's Guide can answer, with at least one
 *  experience, survive (the page filters on counts). */
export const STUDENT_AUDIENCE_ORDER = ['first-time', 'budget', 'foodie', 'slow', 'curious', 'rainy', 'solo', 'nightlife'] as const

export function orderStudentAudiences<T extends { value: string; count: number }>(audiences: T[]): T[] {
  const rank = (v: string) => {
    const i = (STUDENT_AUDIENCE_ORDER as readonly string[]).indexOf(v)
    return i === -1 ? STUDENT_AUDIENCE_ORDER.length : i
  }
  return audiences
    .filter(a => a.count > 0)
    .sort((a, b) => rank(a.value) - rank(b.value))
}

/** An event as the hub's pickers need it. */
export interface StudentEventLike {
  id:                    string
  date:                  string
  time?:                 string
  price:                 number
  vibes:                 string[]
  seriesId?:             string | null
  isRecurring?:          boolean
  isFirstTimerFriendly?: boolean
  status?:               string
}

/** The tag the city's events use for language exchanges (an EventTag name —
 *  /events?tags= filters on the same names). */
export const LANGUAGE_EXCHANGE_TAG = 'Language exchange'
const NIGHTLIFE_TAG = 'Nightlife'

const live = <E extends StudentEventLike>(events: E[]) => events.filter(e => e.status !== 'cancelled')

/** One per series: a weekly session appears once, as its next date. Input is
 *  soonest-first, so the first seen is the next one. */
function oncePerSeries<E extends StudentEventLike>(events: E[]): E[] {
  const seen = new Set<string>()
  return events.filter(e => {
    const key = e.seriesId ? `s:${e.seriesId}` : `e:${e.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** How many first-timer-friendly events the hub's "first event" row shows. */
export const STUDENT_FIRST_EVENT_LIMIT = 3
/** How many regular activities the "find your rhythm" row shows. */
export const STUDENT_REGULAR_LIMIT = 6

/** The "your first event" row: first-timer-friendly events, soonest first,
 *  each weekly session once. */
export function pickFirstEvents<E extends StudentEventLike>(events: E[], limit = STUDENT_FIRST_EVENT_LIMIT): E[] {
  return oncePerSeries(live(events).filter(e => e.isFirstTimerFriendly)).slice(0, limit)
}

/**
 * The "regular things to join" row: recurring activities (a series, or an
 * event marked recurring), each once as its next date, soonest first. At most
 * one of them may be nightlife, so the row reads as a week of things to do
 * rather than a week of bars. Events already in `exclude` (the first-event
 * row) are skipped so the two rows don't repeat each other.
 */
export function pickRegularEvents<E extends StudentEventLike>(events: E[], exclude: Set<string> = new Set(), limit = STUDENT_REGULAR_LIMIT): E[] {
  const recurring = oncePerSeries(live(events).filter(e => e.seriesId || e.isRecurring))
  const out: E[] = []
  let nightlife = 0
  for (const e of recurring) {
    if (out.length >= limit) break
    if (exclude.has(e.id)) continue
    const isNight = e.vibes.includes(NIGHTLIFE_TAG)
    if (isNight && nightlife >= 1) continue
    if (isNight) nightlife++
    out.push(e)
  }
  return out
}

/** A link into the city's event calendar with one of its existing filters
 *  (app/events/EventsClient: ?first=1, ?free=1, ?tags=). Offered only when at
 *  least one upcoming event matches, and labelled with how many. */
export interface EventFilterLink { key: 'first' | 'free' | 'language' | 'regular'; label: string; emoji: string; href: string; count: number }

export function eventsHref(citySlug: string, query = ''): string {
  // The default city's calendar is the bare /events (its canonical); another
  // city pins itself with ?city= so the link survives being shared.
  const params = new URLSearchParams(query)
  if (citySlug !== DEFAULT_CITY_SLUG) params.set('city', citySlug)
  const qs = params.toString()
  return qs ? `/events?${qs}` : '/events'
}

export function eventFilterLinks(events: StudentEventLike[], citySlug: string): EventFilterLink[] {
  const upcoming = live(events)
  const links: EventFilterLink[] = [
    { key: 'first',    emoji: '👋', label: 'First-timer friendly', href: eventsHref(citySlug, 'first=1'), count: upcoming.filter(e => e.isFirstTimerFriendly).length },
    { key: 'free',     emoji: '🆓', label: 'Free to attend',       href: eventsHref(citySlug, 'free=1'),  count: upcoming.filter(e => e.price === 0).length },
    { key: 'language', emoji: '🗣️', label: 'Language exchange',    href: eventsHref(citySlug, `tags=${LANGUAGE_EXCHANGE_TAG}`), count: upcoming.filter(e => e.vibes.includes(LANGUAGE_EXCHANGE_TAG)).length },
  ]
  return links.filter(l => l.count > 0)
}

/** One step of the first-week route. `links` is empty when the city has
 *  nothing to point at; the step still renders — it is still a thing to do —
 *  but says so instead of linking to an empty page. */
export interface FirstWeekStep {
  key:   'connect' | 'city' | 'explore' | 'meet' | 'rhythm'
  title: string
  body:  string
  links: { href: string; label: string }[]
}

export interface FirstWeekInput {
  citySlug:         string
  cityName:         string
  guides:           StudentGuide<StageArticle>[]
  /** Guide audiences with experiences, already ordered (orderStudentAudiences). */
  audiences:        { value: string; label: string }[]
  hasFirstEvents:   boolean
  hasRegular:       boolean
  hasNeighborhoods: boolean
  hasClubs:         boolean
}

const guideLink = (guides: StudentGuide<StageArticle>[], key: StudentGuideKey, label: string) => {
  const g = guides.find(x => x.key === key)
  return g ? [{ href: `/handbook/${g.article.slug}`, label }] : []
}

/**
 * The first week, in five steps, each pointing at the pages that answer it in
 * this city. Paths are basePath-relative (for next/link); `#…` anchors are
 * sections of the hub itself.
 */
export function buildFirstWeek(i: FirstWeekInput): FirstWeekStep[] {
  const cityQs  = i.citySlug !== DEFAULT_CITY_SLUG ? `&city=${i.citySlug}` : ''
  const guideQs = i.citySlug !== DEFAULT_CITY_SLUG ? `?city=${i.citySlug}` : ''
  const audience = (value: string) => i.audiences.find(a => a.value === value)
  const budget = audience('budget')
  const food   = audience('foodie')
  const first  = audience('first-time')
  return [
    {
      key: 'connect',
      title: 'Get connected',
      body: 'A working phone number first: maps, banking codes and every group chat depend on it.',
      links: guideLink(i.guides, 'connect', 'SIM and mobile internet'),
    },
    {
      key: 'city',
      title: 'Learn the city',
      body: 'Get a transport card, work out your commute, and save the emergency number before you need it.',
      links: [
        ...guideLink(i.guides, 'transport', 'Transport card and getting around'),
        ...guideLink(i.guides, 'emergency', 'Emergency numbers'),
        ...guideLink(i.guides, 'safety', 'Scams and staying safe'),
      ],
    },
    {
      key: 'explore',
      title: 'Eat and explore',
      body: `Spend your first free afternoons finding out what ${i.cityName} is like — much of it costs little or nothing.`,
      links: [
        ...(budget ? [{ href: `/guide?for=budget${cityQs}`, label: budget.label }] : []),
        ...(food   ? [{ href: `/guide?for=foodie${cityQs}`, label: food.label }]   : []),
        ...(!budget && !food && first ? [{ href: `/guide?for=first-time${cityQs}`, label: first.label }] : []),
        ...(!budget && !food && !first ? [{ href: `/guide${guideQs}`, label: `The ${i.cityName} Guide` }] : []),
      ],
    },
    {
      key: 'meet',
      title: 'Meet people',
      body: i.hasFirstEvents
        ? 'Pick one event marked first-timer friendly and go — plenty of people come on their own.'
        : 'Pick one event and go — plenty of people come on their own.',
      links: [{ href: i.hasFirstEvents ? '#first-event' : eventsHref(i.citySlug), label: i.hasFirstEvents ? 'First-timer friendly events' : 'See upcoming events' }],
    },
    {
      key: 'rhythm',
      title: 'Find your rhythm',
      body: 'Something every week is how acquaintances become friends. Find a regular activity, and the part of the city that suits you.',
      links: [
        ...(i.hasRegular ? [{ href: '#regular', label: 'Regular activities' }] : []),
        ...(i.hasNeighborhoods ? [{ href: `/neighborhoods${guideQs}`, label: 'Neighbourhoods' }] : []),
        ...(!i.hasRegular && i.hasClubs ? [{ href: `/${i.citySlug}/clubs`, label: 'Clubs' }] : []),
      ],
    },
  ]
}
