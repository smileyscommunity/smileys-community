import { canonicalCategory, categoryMeta } from './handbook-categories'

// The relocation path: the "Moving to <city>" hub (/[city]/moving) and the
// Handbook's life-stage entry points (/handbook/stage/<key>) both read these
// rules, so the hub's timeline and the Handbook's stage pages can never
// disagree about which article belongs to which moment of a move.
//
// Nothing here is content. A stage is a set of canonical Handbook categories;
// it lists whatever published articles the city already has in them and
// disappears when it has none. A city gains a fuller path by gaining
// articles, never by editing this file — and no stage can link to an empty
// page, because "no articles" means "no stage".

export const LIFE_STAGES = [
  {
    key: 'planning', emoji: '🧳', label: "I'm planning my move", timeline: 'Before you arrive',
    blurb: 'Residence permits and where to live — the decisions to make before you land.',
    // Banking is a first-week job (you open the account once you are here),
    // so it lives under arriving; listing it here too put the same guide in
    // two columns of the moving hub's timeline.
    categories: ['Residence & Legal', 'Home & Housing'],
    keywords: /residence|permit|visa|ikamet|apartment|rent|hous/i,
  },
  {
    key: 'arriving', emoji: '🛬', label: 'I just arrived', timeline: 'Your first week',
    blurb: 'Get a working phone, a transport card and a way to pay — the first-week essentials.',
    categories: ['Getting Started', 'Mobile & Digital', 'Getting Around', 'Money & Banking'],
    keywords: /sim|internet|kart|card|metro|bus|ferr|bank/i,
  },
  {
    key: 'settling', emoji: '🏡', label: "I'm settling in", timeline: 'Your first month',
    blurb: 'Healthcare, a longer-term home, family life and the everyday systems that make a city work.',
    categories: ['Home & Housing', 'Healthcare', 'Everyday Life', 'Language & Culture'],
    // Housing stays in the category list (a longer-term home is a settling
    // job too) but not in the keywords, so the apartment guide the planning
    // column already leads with ranks below healthcare and daily life here.
    keywords: /health|doctor|hospital|daily|family|child|utilit/i,
  },
  {
    key: 'urgent', emoji: '🆘', label: 'I need urgent help', timeline: null,
    blurb: 'Staying safe, avoiding scams, and how to get medical help.',
    categories: ['Safety & Emergencies', 'Healthcare'],
    keywords: /scam|safe|emergenc|hospital|health/i,
  },
] as const

export type LifeStageKey = (typeof LIFE_STAGES)[number]['key']
export type LifeStage    = (typeof LIFE_STAGES)[number]

export function lifeStage(key: string): LifeStage | null {
  return LIFE_STAGES.find(s => s.key === key) ?? null
}

export interface StageArticle {
  slug:     string
  title:    string
  category: string
  cityId:   string | null
}

/**
 * The city's articles for one stage: every article in the stage's categories,
 * on-topic ones first (keyword match), then this city's own ahead of national
 * ones, input order otherwise. Uncapped — a stage page lists everything; the
 * hub slices.
 */
export function articlesForStage<A extends StageArticle>(stage: LifeStage, articles: A[], cityId: string): A[] {
  const cats = new Set<string>(stage.categories)
  const score = (a: A) => (stage.keywords.test(`${a.title} ${a.slug}`) ? 2 : 0) + (a.cityId === cityId ? 1 : 0)
  return articles
    .map((a, i) => ({ a, i, key: canonicalCategory(a.category) }))
    .filter(x => x.key !== null && cats.has(x.key))
    .map(x => ({ ...x, s: score(x.a) }))
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map(x => x.a)
}

/** Stages this city can actually fill, each with its articles. */
export function populatedStages<A extends StageArticle>(articles: A[], cityId: string) {
  return LIFE_STAGES
    .map(stage => ({ stage, articles: articlesForStage(stage, articles, cityId) }))
    .filter(s => s.articles.length > 0)
}

/** Whether any of these articles sits in a category the Handbook marks
 *  high-stakes (residence, money, healthcare, safety) — the pages that list
 *  them carry the compact "not legal/medical advice" note only when true. */
export function includesHighStakes(articles: { category: string }[]): boolean {
  return articles.some(a => categoryMeta(a.category)?.highStakes)
}

/** The hub's practical-topic shelf, in the order a move needs them. Each is a
 *  canonical Handbook category; the hub links to the category page and hides
 *  a topic the city has no article for. */
export const MOVING_TOPICS = [
  { category: 'Residence & Legal',    title: 'Residence permits and legal status' },
  { category: 'Home & Housing',       title: 'Housing and neighbourhoods' },
  { category: 'Money & Banking',      title: 'Banking and money' },
  { category: 'Mobile & Digital',     title: 'SIM, home internet and essential apps' },
  { category: 'Healthcare',           title: 'Healthcare' },
  { category: 'Getting Around',       title: 'Transport' },
  { category: 'Safety & Emergencies', title: 'Safety, scams and emergencies' },
] as const

export function movingTopics<A extends StageArticle>(articles: A[]) {
  return MOVING_TOPICS
    .map(t => ({ ...t, articles: articles.filter(a => canonicalCategory(a.category) === t.category) }))
    .filter(t => t.articles.length > 0)
}

export interface NeighborhoodPick {
  name: string; slug: string; emoji: string; vibe: string | null; area: string | null
  members: number; events: number
}

/**
 * "Find your neighbourhood": where members actually live, then where things
 * actually happen. Counts are the real figures the caller passed (activated
 * members, upcoming published events) and a pick with neither is still shown
 * when the city has no activity yet — a young city's registry is still worth
 * browsing, and its cards simply carry no numbers.
 */
export function pickNeighborhoods(
  registry: { name: string; slug: string; emoji: string; vibe: string | null; area: string | null }[],
  memberCounts: Map<string, number>,
  eventCounts: Map<string, number>,
  limit = 6,
): NeighborhoodPick[] {
  return registry
    .map((n, i) => ({ ...n, i, members: memberCounts.get(n.name) ?? 0, events: eventCounts.get(n.name) ?? 0 }))
    .sort((a, b) => b.members - a.members || b.events - a.events || a.i - b.i)
    .slice(0, limit)
    .map(({ i: _i, ...n }) => n)
}
