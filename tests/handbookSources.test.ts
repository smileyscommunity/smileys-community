import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The Handbook source watch (lib/handbookSources), 2026-10-02.
vi.mock('@/lib/prisma', () => ({ prisma: {
  post:           { findMany: vi.fn() },
  handbookSource: { findMany: vi.fn(), upsert: vi.fn(async () => ({})) },
} }))
import { prisma } from '@/lib/prisma'
import {
  normaliseHtml, diffSummary, isWatchableUrl, collectSourceUrls, sourceChangesForQueue, hashOf, runSourceWatch,
} from '@/lib/handbookSources'

const p = prisma as any
const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')

describe('normalising a page', () => {
  it('keeps visible text, drops scripts, nav, header, footer and forms, one block per line', () => {
    const html = `<html><head><style>.x{}</style><script>var t=Date.now()</script></head><body>
      <header>Site menu</header><nav>Home · About</nav>
      <h1>Tariffs</h1><p>Full fare: 46.20 TL</p><p>Student&nbsp;fare: 22.55&amp;up</p>
      <form><input></form><footer>© 2026</footer></body></html>`
    expect(normaliseHtml(html)).toBe('Tariffs\nFull fare: 46.20 TL\nStudent fare: 22.55&up')
  })
  it('digits stay: a fare change IS the change', () => {
    expect(normaliseHtml('<p>46.20 TL</p>')).not.toBe(normaliseHtml('<p>50.80 TL</p>'))
  })
})

describe('the diff a reviewer sees', () => {
  it('lists removed and added lines', () => {
    expect(diffSummary('A\nFull fare: 46.20 TL\nC', 'A\nFull fare: 50.80 TL\nC')).toBe('− Full fare: 46.20 TL\n+ Full fare: 50.80 TL')
  })
  it('a reorder is no change', () => {
    expect(diffSummary('a\nb\nc', 'c\na\nb')).toBeNull()
  })
})

describe('which URLs the server may fetch', () => {
  it('public https only — no http, localhost, internal names or IP literals', () => {
    expect(isWatchableUrl('https://www.ego.gov.tr/tr/sayfa/2098/tasima-ucretleri')).toBe(true)
    for (const bad of ['http://www.ego.gov.tr', 'https://localhost/x', 'https://10.0.0.5/', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://db.internal/', 'https://printer.local', 'not a url', 'https://intranet/'])
      expect(isWatchableUrl(bad)).toBe(false)
  })
  it('collects each cited URL once, skipping the unwatchable', () => {
    expect(collectSourceUrls([
      { officialSources: [{ url: 'https://b.gov.tr/x' }, { url: 'https://a.gov.tr/' }] },
      { officialSources: [{ url: 'https://a.gov.tr/' }, { url: 'http://old.gov.tr' }] },
      { officialSources: null },
    ])).toEqual(['https://a.gov.tr/', 'https://b.gov.tr/x'])
  })
})

describe('the review queue entry', () => {
  const changedAt = new Date('2026-10-05T04:20:00Z')
  const posts = [
    { id: '1', slug: 'istanbulkart', title: 'Istanbulkart', lastReviewedAt: new Date('2026-09-30'), officialSources: [{ url: 'https://fare.gov.tr', label: 'Fares' }] },
    { id: '2', slug: 'reviewed-after', title: 'Later', lastReviewedAt: new Date('2026-10-06'), officialSources: [{ url: 'https://fare.gov.tr', label: 'Fares' }] },
    { id: '3', slug: 'never', title: 'Never', lastReviewedAt: null, officialSources: [{ url: 'https://fare.gov.tr', label: 'Fares' }] },
    { id: '4', slug: 'other', title: 'Other', lastReviewedAt: null, officialSources: [{ url: 'https://quiet.gov.tr', label: 'Quiet' }] },
  ]
  it('lists articles citing a changed source that were not reviewed since; a review clears it', () => {
    const out = sourceChangesForQueue(posts, [
      { url: 'https://fare.gov.tr', changedAt, lastDiff: '− 46.20\n+ 50.80' },
      { url: 'https://quiet.gov.tr', changedAt: null, lastDiff: null },
    ])
    expect(out.map(c => c.slug)).toEqual(['istanbulkart', 'never'])
    expect(out[0]).toMatchObject({ label: 'Fares', diff: '− 46.20\n+ 50.80' })
  })
})

describe('the weekly sweep', () => {
  const realFetch = global.fetch
  let pages: Record<string, { status?: number; body: string; type?: string } | Error>
  beforeEach(() => {
    vi.clearAllMocks()
    p.post.findMany.mockResolvedValue([{ officialSources: [
      { url: 'https://same.gov.tr' }, { url: 'https://new.gov.tr' }, { url: 'https://fare.gov.tr' }, { url: 'https://shuffle.gov.tr' }, { url: 'https://down.gov.tr' },
    ] }])
    const known = (t: string) => ({ contentHash: hashOf(t), text: t })
    p.handbookSource.findMany.mockResolvedValue([
      { url: 'https://same.gov.tr',    ...known('Hello') },
      { url: 'https://fare.gov.tr',    ...known('Full fare: 46.20 TL') },
      { url: 'https://shuffle.gov.tr', ...known('a\nb') },
      { url: 'https://down.gov.tr',    ...known('x') },
    ])
    pages = {
      'https://same.gov.tr':    { body: '<p>Hello</p>' },
      'https://new.gov.tr':     { body: '<p>First time</p>' },
      'https://fare.gov.tr':    { body: '<p>Full fare: 50.80 TL</p>' },
      'https://shuffle.gov.tr': { body: '<p>b</p><p>a</p>' },
      'https://down.gov.tr':    { status: 503, body: '' },
    }
    global.fetch = vi.fn(async (url: any) => {
      const pg = pages[String(url)]
      if (pg instanceof Error) throw pg
      return new Response(pg.body, { status: pg.status ?? 200, headers: { 'content-type': pg.type ?? 'text/html; charset=utf-8' } })
    }) as any
  })
  afterEach(() => { global.fetch = realFetch })

  it('baselines new pages, stamps real changes with a diff, ignores reorders, records errors', async () => {
    const r = await runSourceWatch(new Date('2026-10-05T04:15:00Z'))
    expect(r).toEqual({ checked: 5, changed: 1, baselined: 1, failed: 1 })
    const upserts = Object.fromEntries((p.handbookSource.upsert.mock.calls as any[]).map(c => [c[0].where.url, c[0]]))
    expect(upserts['https://fare.gov.tr'].update).toMatchObject({ lastDiff: '− Full fare: 46.20 TL\n+ Full fare: 50.80 TL' })
    expect(upserts['https://fare.gov.tr'].update.changedAt).toBeInstanceOf(Date)
    expect(upserts['https://same.gov.tr'].update.changedAt).toBeUndefined()
    expect(upserts['https://shuffle.gov.tr'].update.changedAt).toBeUndefined()
    expect(upserts['https://new.gov.tr'].create.changedAt).toBeUndefined()
    expect(upserts['https://down.gov.tr'].update).toMatchObject({ lastStatus: 503, lastError: 'HTTP 503' })
    // An error never overwrites the last good content.
    expect(upserts['https://down.gov.tr'].update.contentHash).toBeUndefined()
  })
})

describe('wiring', () => {
  it('weekly crontab via deploy.sh, a monitored sweeper, an authorized cron route', () => {
    expect(read('deploy.sh')).toContain("echo '15 4 * * 1 $REMOTE/scripts/sweep-handbook-sources.sh >> /var/log/sweep-handbook-sources.log 2>&1'")
    expect(read('lib/cronHealth.ts')).toContain("'sweep-handbook-sources': 7 * 24 * 60,")
    const route = read('app/api/cron/sweep-handbook-sources/route.ts')
    expect(route).toContain('const denied = await checkCronAuth(req)')
    expect(read('scripts/sweep-handbook-sources.sh')).toContain('--max-time 900')
  })
  it('the queue API is staff-only and scoped like the posts list', () => {
    const api = read('app/api/admin/handbook-sources/route.ts')
    expect(api).toContain("if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })")
    expect(api).toContain('...(isAdmin(session) ? {} : { cityId: failClosedCityId(session) })')
  })
})
