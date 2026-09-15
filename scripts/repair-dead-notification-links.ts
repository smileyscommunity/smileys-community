// Find and repair notification links that open a page that doesn't exist.
//
// scripts/fix-scan4-data.ts (2026-09-13) only matched `/events/<id>` whose event
// was deleted. The 2026-09 production audit then found 50 more dead links in
// formats it never looked at:
//   · `/app/...`         lib/spotOpened.ts wrote `/app/events/<id>` from
//                        2026-09-02 to 2026-09-14. Notification links are
//                        pushed through the router, which adds the basePath
//                        again → /app/app/events/<id>.
//   · `/clubs/<clubId>`  every club broadcast (club pages are /clubs/<slug>)
//   · `/listings/...`    the board's pre-rename path, alive only via a redirect
//   · id/slug links whose target row has since been deleted, on every page
//     type other than /events/<id>
//
// Every link is matched against the app's page routes (PAGE_ROUTES, which
// tests/scan5Batch37 keeps equal to app/**/page.tsx) and, for id/slug routes,
// against the target row:
//   LIVE        the route exists and so does its target row
//   REWRITABLE  a known wrong format → the proposed rewrite (itself LIVE)
//   DEAD        no such page, or the target row is gone → link set to null (the
//               bell then opens /notifications, where the full body shows)
//   UNVERIFIED  an absolute URL, or a page whose param has no table to check
//               (/guide/<slug> reads guide files, /guide/routes/<slug>,
//               /handbook/category/<key>) — listed, never written
// "Target exists" means the row exists: an unapproved business or a closed
// moving sale still counts as LIVE.
//
//   DRY_RUN (default): every pattern with its class and count, and every
//                      REWRITABLE / DEAD / UNVERIFIED row in full.
//   VERBOSE=1:         also list every LIVE row.
//   APPLY=1:           apply the rewrites and nulls, each guarded on the link it
//                      read (WHERE id=… AND link=<old>), so a re-run finds
//                      nothing and a row changed meanwhile is left alone.
//
// Run on the server with both env files:
//   npx tsx --env-file=.env --env-file=.env.local scripts/repair-dead-notification-links.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/repair-dead-notification-links.ts

// ── Routes ──────────────────────────────────────────────────────────────────

/** Every page under app/, route groups removed. tests/scan5Batch37 fails when this drifts from the filesystem. */
export const PAGE_ROUTES = [
  '/', '/[city]', '/[city]/board', '/[city]/clubs', '/[city]/directory', '/[city]/events',
  '/about', '/activate', '/admin', '/admin/analytics', '/admin/announcements', '/admin/applications', '/admin/audit',
  '/admin/banners', '/admin/campaigns', '/admin/campaigns/[id]', '/admin/checkin', '/admin/cities', '/admin/club-requests', '/admin/clubs',
  '/admin/clubs/[id]', '/admin/content', '/admin/directory', '/admin/engagement', '/admin/events',
  '/admin/events/[id]/edit', '/admin/events/[id]/participants', '/admin/events/new', '/admin/feedback', '/admin/guide',
  '/admin/guide-entries', '/admin/hangouts', '/admin/hosts', '/admin/listings', '/admin/listings/[id]',
  '/admin/listings/bulk', '/admin/listings/new', '/admin/moderation', '/admin/moderator', '/admin/moving-sales',
  '/admin/neighborhoods', '/admin/neighborhoods/[slug]', '/admin/newsletter', '/admin/no-shows', '/admin/notifications',
  '/admin/nps', '/admin/participants', '/admin/partners', '/admin/partners/new', '/admin/payments', '/admin/polls',
  '/admin/posts', '/admin/posts/[id]/edit', '/admin/posts/new', '/admin/pro-waitlist', '/admin/retention',
  '/admin/security', '/admin/settings', '/admin/sponsors', '/admin/spotlight', '/admin/stories', '/admin/tags',
  '/admin/users', '/admin/users/[id]', '/advertise', '/appeal', '/apply', '/board', '/board/[id]', '/board/new',
  '/board/renew/[id]', '/card', '/cities', '/clubs', '/clubs/[slug]', '/clubs/feed', '/contact', '/contacts', '/cookies',
  '/cup', '/dashboard', '/directory', '/directory/[id]', '/directory/saved', '/directory/submit', '/events',
  '/events/[id]', '/events/[id]/feedback', '/events/[id]/recap', '/experiences', '/faq', '/forgot-password',
  '/get-involved', '/guide', '/guide/[slug]', '/guide/routes/[slug]', '/guidelines', '/handbook', '/handbook/[slug]',
  '/handbook/category/[key]', '/hangouts', '/hangouts/[id]', '/hangouts/recap', '/host', '/host/checkin', '/host/clubs',
  '/host/clubs/[slug]', '/host/events', '/host/events/[id]/edit', '/host/events/[id]/participants', '/host/events/new',
  '/hosts', '/invite', '/login', '/marketplace', '/members', '/members/[id]', '/messages', '/messages/[userId]',
  '/moving-sales/[id]', '/my-events', '/neighborhoods', '/neighborhoods/[slug]', '/no-show', '/notifications',
  '/notifications/settings', '/partner', '/partner/settings', '/pending', '/perks', '/posts', '/posts/[slug]', '/privacy',
  '/pro', '/profile', '/profile-visitors', '/reset-password', '/reviews', '/settings', '/share-story', '/survey/nps',
  '/terms', '/unsubscribe', '/verify-email', '/visiting', '/visiting/new', '/why',
] as const

export type TargetKey =
  | 'event' | 'user' | 'listing' | 'boardPost' | 'business' | 'hangout' | 'movingSale' | 'campaign'
  | 'club.id' | 'club.slug' | 'post.id' | 'post.slug' | 'neighborhood.slug' | 'city.slug'

/** Which row a dynamic page needs. A dynamic route missing here is UNVERIFIED. */
export const ROUTE_TARGETS: Record<string, { param: string; target: TargetKey }> = {
  '/[city]':                         { param: 'city',   target: 'city.slug' },
  '/[city]/board':                   { param: 'city',   target: 'city.slug' },
  '/[city]/clubs':                   { param: 'city',   target: 'city.slug' },
  '/[city]/directory':               { param: 'city',   target: 'city.slug' },
  '/[city]/events':                  { param: 'city',   target: 'city.slug' },
  '/admin/campaigns/[id]':           { param: 'id',     target: 'campaign' },
  '/admin/clubs/[id]':               { param: 'id',     target: 'club.id' },
  '/admin/events/[id]/edit':         { param: 'id',     target: 'event' },
  '/admin/events/[id]/participants': { param: 'id',     target: 'event' },
  '/admin/listings/[id]':            { param: 'id',     target: 'listing' },
  '/admin/neighborhoods/[slug]':     { param: 'slug',   target: 'neighborhood.slug' },
  '/admin/posts/[id]/edit':          { param: 'id',     target: 'post.id' },
  '/admin/users/[id]':               { param: 'id',     target: 'user' },
  '/board/[id]':                     { param: 'id',     target: 'listing' },
  '/board/renew/[id]':                { param: 'id',     target: 'listing' },
  '/clubs/[slug]':                   { param: 'slug',   target: 'club.slug' },
  '/directory/[id]':                 { param: 'id',     target: 'business' },
  '/events/[id]':                    { param: 'id',     target: 'event' },
  '/events/[id]/feedback':           { param: 'id',     target: 'event' },
  '/events/[id]/recap':              { param: 'id',     target: 'event' },
  '/handbook/[slug]':                { param: 'slug',   target: 'post.slug' },
  '/hangouts/[id]':                  { param: 'id',     target: 'hangout' },
  '/host/clubs/[slug]':              { param: 'slug',   target: 'club.slug' },
  '/host/events/[id]/edit':          { param: 'id',     target: 'event' },
  '/host/events/[id]/participants':  { param: 'id',     target: 'event' },
  '/members/[id]':                   { param: 'id',     target: 'user' },
  '/messages/[userId]':              { param: 'userId', target: 'user' },
  '/moving-sales/[id]':              { param: 'id',     target: 'movingSale' },
  '/neighborhoods/[slug]':           { param: 'slug',   target: 'neighborhood.slug' },
  '/posts/[slug]':                   { param: 'slug',   target: 'post.slug' },
}

/** Query params that name a row the page opens (`/board?post=<id>` deep-links a board post). */
export const QUERY_TARGETS: Record<string, Record<string, TargetKey>> = {
  '/board':        { post: 'boardPost' },
  '/reviews':      { event: 'event' },
  '/host/checkin': { event: 'event' },
  '/admin/checkin': { event: 'event' },
}

/** next.config.js redirects: links that only work because of one are rewritten to the destination. */
const REDIRECTS: [RegExp, string][] = [
  [/^\/listings(?=\/|$)/, '/board'],
  [/^\/admin\/cup$/, '/admin/campaigns'],
  [/^\/handbook\/istanbul-sim-card-and-internet-guide$/, '/handbook/sim-card-and-home-internet-in-turkiye'],
]

const segs = (path: string) => path.split('/').filter(Boolean)
const isParam = (s: string) => /^\[[^\]]+\]$/.test(s)

/** Next's precedence: at each level a literal segment beats a dynamic one. */
export function matchRoute(path: string, routes: readonly string[] = PAGE_ROUTES): { route: string; params: Record<string, string> } | null {
  const parts = segs(path)
  let best: { route: string; params: Record<string, string>; rank: string } | null = null
  for (const route of routes) {
    const rs = segs(route)
    if (rs.length !== parts.length) continue
    const params: Record<string, string> = {}
    let rank = ''
    let ok = true
    for (let i = 0; i < rs.length; i++) {
      if (isParam(rs[i])) {
        let v = parts[i]
        try { v = decodeURIComponent(v) } catch { /* keep raw */ }
        params[rs[i].slice(1, -1)] = v
        rank += '1'
      } else if (rs[i] === parts[i]) {
        rank += '0'
      } else { ok = false; break }
    }
    if (ok && (!best || rank < best.rank)) best = { route, params, rank }
  }
  return best && { route: best.route, params: best.params }
}

function splitLink(link: string): { path: string; rest: string; query: URLSearchParams } {
  const i = link.search(/[?#]/)
  const rawPath = i === -1 ? link : link.slice(0, i)
  const rest    = i === -1 ? '' : link.slice(i)
  const q       = rest.startsWith('?') ? rest.slice(1).split('#')[0] : ''
  const path    = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath
  return { path: path || '/', rest, query: new URLSearchParams(q) }
}

/** Format-only rewrites that need no data: basePath prefix, missing leading slash, next.config redirects. */
export function normalizeLinkFormat(link: string): { link: string; rules: string[] } {
  const rules: string[] = []
  let out = link
  if (!out.startsWith('/')) { out = `/${out}`; rules.push('missing leading /') }
  // The router adds the basePath itself; a stored /app doubles it.
  while (/^\/app(?=[/?#]|$)/.test(out)) { out = out.slice(4) || '/'; if (!out.startsWith('/')) out = `/${out}`; rules.push('/app prefix') }
  for (const [re, to] of REDIRECTS) {
    const { path, rest } = splitLink(out)
    if (re.test(path)) { out = path.replace(re, to) + rest; rules.push(`redirect ${to}`) }
  }
  return { link: out, rules: [...new Set(rules)] }
}

// ── Planning ────────────────────────────────────────────────────────────────

export type ExistenceIndex = {
  keys:          Partial<Record<TargetKey, Set<string>>>
  clubSlugById:  Map<string, string>
  /** createdAt of every post loaded by slug. Used to rule out a `-N` link older than its would-be original. */
  postCreatedAtBySlug?: Map<string, Date>
}

export type LinkStatus = 'LIVE' | 'REWRITABLE' | 'DEAD' | 'UNVERIFIED'
export type LinkVerdict = { status: LinkStatus; pattern: string; newLink?: string | null; reason: string }

const isAbsolute = (link: string) => /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('//')

/**
 * A post re-saved under a taken slug got a `-1` suffix; when that copy is
 * later removed, the original (`…-paranoid`) is still live. The 2026-09-14 dry
 * run listed 1,198 `new_article` links to such a `-1` slug as DEAD — they
 * belong on the original, not nulled. Returns the un-suffixed slug, or null.
 *
 * Only -1..-9: the posts route counts up from -1, and a title that really ends
 * in a number (`istanbul-in-48`) must not become `istanbul-in` just because
 * that slug exists. classifyLink also requires the base slug to exist exactly
 * and, when dates are known, the link to be newer than that post.
 */
export function originalPostSlug(slug: string): string | null {
  const m = slug.match(/^(.+)-[1-9]$/)
  return m ? m[1] : null
}

const DUPLICATE_RULE = 'duplicate slug → original'

/** Every (target, key) the links need looked up. Club slugs are also tried as ids — broadcasts wrote ids. */
export function referencedKeys(links: Iterable<string>): Map<TargetKey, Set<string>> {
  const out = new Map<TargetKey, Set<string>>()
  const add = (t: TargetKey, k: string) => { if (!out.has(t)) out.set(t, new Set()); out.get(t)!.add(k) }
  for (const raw of links) {
    if (!raw || isAbsolute(raw)) continue
    const { path, query } = splitLink(normalizeLinkFormat(raw).link)
    const m = matchRoute(path)
    if (!m) continue
    const t = ROUTE_TARGETS[m.route]
    if (t) {
      add(t.target, m.params[t.param])
      if (t.target === 'club.slug') add('club.id', m.params[t.param])
      const base = t.target === 'post.slug' ? originalPostSlug(m.params[t.param]) : null
      if (base) add('post.slug', base)
    }
    for (const [k, target] of Object.entries(QUERY_TARGETS[m.route] ?? {})) {
      const v = query.get(k)
      if (v) add(target, v)
    }
  }
  return out
}

/** A stable grouping label: the matched route (plus query keys), or the path with id-looking segments masked. */
function patternOf(path: string, query: URLSearchParams, route: string | null, rules: string[]): string {
  const keys  = [...new Set(query.keys())].sort()
  const base  = route ?? ('/' + segs(path).map(s => (/\d/.test(s) && s.length >= 8) ? '[?]' : s).join('/'))
  const shown = base + (keys.length ? `?${keys.join('&')}` : '')
  return rules.length ? `${shown}  (${rules.join(', ')})` : shown
}

/** `linkCreatedAt` is the notification's createdAt; without it the duplicate rewrite falls back to slug shape + existence. */
export function classifyLink(link: string, index: ExistenceIndex, linkCreatedAt?: Date): LinkVerdict {
  if (isAbsolute(link)) return { status: 'UNVERIFIED', pattern: '<absolute URL>', reason: 'absolute URL — not an app page' }

  const norm  = normalizeLinkFormat(link)
  const rules = [...norm.rules]
  let candidate = norm.link
  const { path, rest, query } = splitLink(candidate)
  const m = matchRoute(path)
  if (!m) return { status: 'DEAD', pattern: patternOf(path, query, null, rules), newLink: null, reason: 'no such page' }

  const has = (t: TargetKey, k: string) => index.keys[t]?.has(k) ?? false
  const t = ROUTE_TARGETS[m.route]
  let unverified = false
  if (t) {
    const v = m.params[t.param]
    if (!has(t.target, v)) {
      const clubSlug = t.target === 'club.slug' ? index.clubSlugById.get(v) : undefined
      const original = t.target === 'post.slug' ? originalPostSlug(v) : null
      const originalAt = original ? index.postCreatedAtBySlug?.get(original) : undefined
      // A copy is always newer than the post whose slug it collided with, and
      // its notifications newer still. A link older than the "original" was never about its copy.
      const olderThanOriginal = !!(originalAt && linkCreatedAt && linkCreatedAt.getTime() < originalAt.getTime())
      if (clubSlug) {
        // Broadcasts addressed the club by id; the page wants its slug.
        candidate = m.route.replace('[slug]', encodeURIComponent(clubSlug)) + rest
        rules.push('club id → slug')
      } else if (original && has('post.slug', original) && !olderThanOriginal) {
        candidate = m.route.replace('[slug]', encodeURIComponent(original)) + rest
        rules.push(DUPLICATE_RULE)
      } else {
        return { status: 'DEAD', pattern: patternOf(path, query, m.route, rules), newLink: null, reason: `${t.target.split('.')[0]} ${v} no longer exists` }
      }
    }
  } else if (m.route.includes('[')) {
    unverified = true
  }
  for (const [k, target] of Object.entries(QUERY_TARGETS[m.route] ?? {})) {
    const v = query.get(k)
    if (v && !has(target, v)) {
      return { status: 'DEAD', pattern: patternOf(path, query, m.route, rules), newLink: null, reason: `${target} ${v} (?${k}) no longer exists` }
    }
  }

  const pattern = patternOf(path, query, m.route, rules)
  if (candidate !== link) return { status: 'REWRITABLE', pattern, newLink: candidate, reason: rules.join(', ') }
  if (unverified) return { status: 'UNVERIFIED', pattern, reason: 'route exists; its param has no table to check' }
  return { status: 'LIVE', pattern, reason: 'ok' }
}

export type NotificationLinkRow = { id: string; link: string; type?: string; createdAt?: Date }
export type PlannedLink = NotificationLinkRow & LinkVerdict

export function planLinkRepairs(rows: NotificationLinkRow[], index: ExistenceIndex): PlannedLink[] {
  const cache = new Map<string, LinkVerdict>()
  const classify = (key: string, link: string, at?: Date) => {
    let v = cache.get(key)
    if (!v) { v = classifyLink(link, index, at); cache.set(key, v) }
    return v
  }
  const originalAt = new Map<string, Date | undefined>()
  return rows.map(r => {
    let v = classify(r.link, r.link)
    // Only the duplicate rewrite depends on the row's date, and only on whether
    // it predates the original post, so each link has at most two verdicts.
    if (r.createdAt && v.newLink && v.reason.includes(DUPLICATE_RULE)) {
      if (!originalAt.has(r.link)) {
        const slug = matchRoute(splitLink(v.newLink).path)?.params.slug
        originalAt.set(r.link, slug ? index.postCreatedAtBySlug?.get(slug) : undefined)
      }
      const at = originalAt.get(r.link)
      if (at && r.createdAt.getTime() < at.getTime()) v = classify(`${r.link} older`, r.link, r.createdAt)
    }
    return { ...r, ...v }
  })
}

/** The only rows APPLY=1 writes. */
export function linkRepairWrites(plan: PlannedLink[]): { id: string; oldLink: string; newLink: string | null }[] {
  return plan
    .filter(p => p.status === 'REWRITABLE' || p.status === 'DEAD')
    .map(p => ({ id: p.id, oldLink: p.link, newLink: p.status === 'DEAD' ? null : p.newLink! }))
}

export function summarizePlan(plan: PlannedLink[]): { status: LinkStatus; pattern: string; count: number }[] {
  const groups = new Map<string, { status: LinkStatus; pattern: string; count: number }>()
  for (const p of plan) {
    const key = `${p.status} ${p.pattern}`
    const g = groups.get(key) ?? { status: p.status, pattern: p.pattern, count: 0 }
    g.count++
    groups.set(key, g)
  }
  const order: LinkStatus[] = ['DEAD', 'REWRITABLE', 'UNVERIFIED', 'LIVE']
  return [...groups.values()].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.count - a.count || a.pattern.localeCompare(b.pattern))
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  const { prisma } = await import('@/lib/prisma')
  const APPLY   = process.env.APPLY === '1'
  const VERBOSE = process.env.VERBOSE === '1'

  const rows: NotificationLinkRow[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await prisma.notification.findMany({
      where:   { link: { not: null } },
      select:  { id: true, link: true, type: true, createdAt: true },
      orderBy: { id: 'asc' },
      take:    5000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    for (const n of page) rows.push({ id: n.id, link: n.link!, type: n.type, createdAt: n.createdAt })
    if (page.length < 5000) break
    cursor = page[page.length - 1].id
  }

  const wanted = referencedKeys(new Set(rows.map(r => r.link)))
  const index: ExistenceIndex = { keys: {}, clubSlugById: new Map() }
  const chunks = (s: Set<string> | undefined) => {
    const all = [...(s ?? [])]
    return Array.from({ length: Math.ceil(all.length / 1000) }, (_, i) => all.slice(i * 1000, (i + 1) * 1000))
  }
  const load = async (t: TargetKey, find: (keys: string[]) => Promise<string[]>) => {
    const found = new Set<string>()
    for (const c of chunks(wanted.get(t))) for (const k of await find(c)) found.add(k)
    index.keys[t] = found
  }
  const ids = <T extends { id: string }>(r: T[]) => r.map(x => x.id)
  await load('event',      k => prisma.event.findMany({ where: { id: { in: k } }, select: { id: true } }).then(ids))
  await load('user',       k => prisma.user.findMany({ where: { id: { in: k } }, select: { id: true } }).then(ids))
  await load('listing',    k => prisma.listing.findMany({ where: { id: { in: k } }, select: { id: true } }).then(ids))
  await load('boardPost',  k => prisma.boardPost.findMany({ where: { id: { in: k } }, select: { id: true } }).then(ids))
  await load('business',   k => prisma.business.findMany({ where: { id: { in: k } }, select: { id: true } }).then(ids))
  await load('hangout',    k => prisma.hangout.findMany({ where: { id: { in: k } }, select: { id: true } }).then(ids))
  await load('movingSale', k => prisma.movingSale.findMany({ where: { id: { in: k } }, select: { id: true } }).then(ids))
  await load('campaign',   k => prisma.campaign.findMany({ where: { id: { in: k } }, select: { id: true } }).then(ids))
  await load('post.id',    k => prisma.post.findMany({ where: { id: { in: k } }, select: { id: true } }).then(ids))
  index.postCreatedAtBySlug = new Map()
  await load('post.slug',  async k => {
    const posts = await prisma.post.findMany({ where: { slug: { in: k } }, select: { slug: true, createdAt: true } })
    for (const p of posts) index.postCreatedAtBySlug!.set(p.slug, p.createdAt)
    return posts.map(x => x.slug)
  })
  await load('city.slug',  k => prisma.city.findMany({ where: { slug: { in: k } }, select: { slug: true } }).then(r => r.map(x => x.slug)))
  await load('neighborhood.slug', k => prisma.neighborhood.findMany({ where: { slug: { in: k } }, select: { slug: true } }).then(r => r.map(x => x.slug)))
  await load('club.slug',  k => prisma.club.findMany({ where: { slug: { in: k } }, select: { slug: true } }).then(r => r.map(x => x.slug)))
  await load('club.id',    async k => {
    const clubs = await prisma.club.findMany({ where: { id: { in: k } }, select: { id: true, slug: true } })
    for (const c of clubs) index.clubSlugById.set(c.id, c.slug)
    return ids(clubs)
  })

  const plan    = planLinkRepairs(rows, index)
  const summary = summarizePlan(plan)
  const count   = (s: LinkStatus) => plan.filter(p => p.status === s).length

  console.log(`\nPatterns (${summary.length})`)
  for (const g of summary) console.log(`  ${g.status.padEnd(10)} ${String(g.count).padStart(7)}  ${g.pattern}`)

  // Full lists, never truncated.
  const list = (s: LinkStatus) => {
    const rs = plan.filter(p => p.status === s)
    console.log(`\n${s} (${rs.length})${s === 'UNVERIFIED' ? ' — never written' : ''}`)
    for (const p of rs) {
      const to = s === 'REWRITABLE' ? ` → ${p.newLink}` : s === 'DEAD' ? ' → null' : ''
      console.log(`  ${p.id}  ${p.createdAt?.toISOString() ?? ''}  ${(p.type ?? '').padEnd(24)} ${p.link}${to}  [${p.reason}]`)
    }
  }
  list('REWRITABLE'); list('DEAD'); list('UNVERIFIED')
  if (VERBOSE) list('LIVE')

  const writes = linkRepairWrites(plan)
  console.log(`\ncounts: links=${plan.length} live=${count('LIVE')} rewritable=${count('REWRITABLE')} dead=${count('DEAD')} unverified=${count('UNVERIFIED')} writes=${writes.length}`)

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with APPLY=1 to rewrite ${count('REWRITABLE')} and null ${count('DEAD')}.`)
    await prisma.$disconnect()
    return
  }

  let rewritten = 0, nulled = 0, skipped = 0
  for (const w of writes) {
    const { count: n } = await prisma.notification.updateMany({ where: { id: w.id, link: w.oldLink }, data: { link: w.newLink } })
    if (!n) skipped++
    else if (w.newLink === null) nulled++
    else rewritten++
  }
  console.log(`\nAPPLY — rewrote ${rewritten}, nulled ${nulled}; ${skipped} skipped (link changed or row gone since the read).`)
  await prisma.$disconnect()
}

if (/repair-dead-notification-links\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 })
}
