import { canonicalCategory } from './handbook-categories'
import { safeTz } from './cityTime'

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
 *  ranks articles inside a broad category ('Home & Housing' also holds the
 *  daily-life piece), so the most on-topic one leads. */
export const REMOTE_WORK_TOPICS = [
  { key: 'connect',   title: 'SIM, eSIM and home internet', category: 'Mobile & Digital',  keywords: /sim|internet|mobile|esim|phone/i },
  { key: 'housing',   title: 'Housing and neighbourhoods',  category: 'Home & Housing',    keywords: /apartment|rent|hous|home|flat/i },
  { key: 'money',     title: 'Banking and money',           category: 'Money & Banking',   keywords: /bank|money|card|tax/i },
  { key: 'transport', title: 'Getting around',              category: 'Getting Around',    keywords: /card|metro|bus|ferr|transport|kart/i },
  { key: 'legal',     title: 'Visas and residence',         category: 'Residence & Legal', keywords: /residence|permit|visa|ikamet|i̇kamet/i },
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
    const score = (a: A) =>
      (topic.keywords.test(`${a.title} ${a.slug}`) ? 2 : 0) + (a.cityId === cityId ? 1 : 0)
    const ranked = inCategory
      .map((a, i) => ({ a, i, s: score(a) }))
      .sort((x, y) => y.s - x.s || x.i - y.i)
      .map(x => x.a)
      .slice(0, ARTICLES_PER_TOPIC)
    return [{ key: topic.key, title: topic.title, articles: ranked }]
  })
}

/** Club names that mean "people who work from here". Matched on the name
 *  because clubs carry no work flag; Newcomers is included on purpose — it is
 *  the other door a solo arrival walks through. */
export const WORK_CLUB_PATTERN = /cowork|co-work|remote|nomad|newcomer/i

export function isWorkClub(name: string): boolean {
  return WORK_CLUB_PATTERN.test(name)
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
  key:    'connect' | 'neighbourhood' | 'workspace' | 'money' | 'first-event'
  title:  string
  body:   string
  href:   string | null
  cta:    string
}

export interface ChecklistInput {
  citySlug:         string
  topics:           HubTopic[]
  hasNeighborhoods: boolean
  hasWorkClubs:     boolean
  // Upcoming events from those clubs — the only evidence that "members run
  // coworking sessions" is true this month rather than once upon a time.
  hasWorkEvents:    boolean
  hasEvents:        boolean
}

const topicHref = (topics: HubTopic[], key: RemoteWorkTopicKey) => {
  const first = topics.find(t => t.key === key)?.articles[0]
  return first ? `/handbook/${first.slug}` : null
}

/**
 * The first-72-hours path, each step pointing at the one page that answers
 * it in this city. Paths are basePath-relative (for next/link).
 */
export function buildChecklist({ citySlug, topics, hasNeighborhoods, hasWorkClubs, hasWorkEvents, hasEvents }: ChecklistInput): ChecklistStep[] {
  const moneyHref     = topicHref(topics, 'money')
  const transportHref = topicHref(topics, 'transport')
  return [
    {
      key: 'connect',
      title: 'Get connected',
      body: 'Sort out a SIM or eSIM on day one, and home internet if you are staying a while.',
      href: topicHref(topics, 'connect'),
      cta:  'Read the SIM and internet guide',
    },
    {
      key: 'neighbourhood',
      title: 'Choose a neighbourhood',
      body: 'Where you stay decides your commute, your cafés and who is around in the evening.',
      href: hasNeighborhoods ? `/neighborhoods?city=${citySlug}` : topicHref(topics, 'housing'),
      cta:  'Compare neighbourhoods',
    },
    {
      key: 'workspace',
      title: 'Find somewhere to work',
      body: hasWorkEvents
        ? 'Members run regular coworking sessions — a desk, some company, and people to have lunch with.'
        : hasWorkClubs
          ? 'Join a coworking or remote-work club to hear where members actually work from.'
          : 'Once you are in, ask members where they work from — there is no workspace list here yet.',
      href: hasWorkClubs ? '#work-and-meet' : null,
      cta:  hasWorkEvents ? 'See coworking sessions' : 'See the clubs',
    },
    {
      key: 'money',
      title: 'Sort money and transport',
      body: 'How to pay, how to get a local account if you need one, and the card that gets you on transit.',
      href: moneyHref ?? transportHref,
      cta:  moneyHref ? 'Read the money guide' : 'Read the transport guide',
    },
    {
      key: 'first-event',
      title: 'Join a first event',
      body: 'Pick something marked first-timer friendly, or a coworking session, and show up.',
      href: hasEvents ? '#work-and-meet' : `/${citySlug}/events`,
      cta:  'See upcoming events',
    },
  ]
}
