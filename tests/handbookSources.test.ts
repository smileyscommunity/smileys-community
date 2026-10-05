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
  normaliseHtml, diffSummary, isWatchableUrl, isNoisyUrl, isVolatileLine, comparableText, collectSourceUrls, sourceChangesForQueue, hashOf, runSourceWatch,
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
      { officialSources: [{ url: 'https://b.gov.tr/x' }, { url: 'https://a.gov.tr/fares' }] },
      { officialSources: [{ url: 'https://a.gov.tr/fares' }, { url: 'http://old.gov.tr' }] },
      { officialSources: null },
    ])).toEqual(['https://a.gov.tr/fares', 'https://b.gov.tr/x'])
  })
})

describe('noise the watch ignores', () => {
  it('news, announcements, app-store pages and bare homepages are not watched', () => {
    for (const u of [
      'https://apps.apple.com/tr/app/estram-mobil/id1600637577',
      'https://bigpara.hurriyet.com.tr/haberler/genel-haberler/izbanda-90-dakika_ID1616578/',
      'https://www.bursa.bel.tr/haber/toplu-ulasimda-temassiz-donem-32671',
      'https://ticaret.gov.tr/haberler/fiyat-etiketi',
      'https://www.turkiye.gov.tr',
      'https://www.sgk.gov.tr/',
    ]) expect(isNoisyUrl(u)).toBe(true)
    for (const u of [
      'https://www.turkiye.gov.tr/non-citizens',
      'https://www.garantibbva.com.tr/urun-ve-hizmet-ucretleri',
      'https://www.lexpera.com.tr/mevzuat/yonetmelikler/tasinmaz-ticareti-hakkinda-yonetmelik/8',
      'https://www.istanbulkart.istanbul/?lang=en',
    ]) expect(isNoisyUrl(u)).toBe(false)
  })
  it('a noisy source never reaches the watch list or the review queue, even with an old change on file', () => {
    expect(collectSourceUrls([{ officialSources: [{ url: 'https://www.turkiye.gov.tr' }, { url: 'https://a.gov.tr/fares' }] }])).toEqual(['https://a.gov.tr/fares'])
    const posts = [{ id: '1', slug: 's', title: 'S', lastReviewedAt: null, officialSources: [{ url: 'https://www.sgk.gov.tr', label: 'SGK' }, { url: 'https://a.gov.tr/fares', label: 'Fares' }] }]
    const changedAt = new Date('2026-10-05')
    expect(sourceChangesForQueue(posts, [{ url: 'https://www.sgk.gov.tr', changedAt, lastDiff: 'x' }, { url: 'https://a.gov.tr/fares', changedAt, lastDiff: 'y' }]).map(c => c.url)).toEqual(['https://a.gov.tr/fares'])
  })
  it('timestamps, clocks, relative times, counters and weather lines are volatile; rules and fares are not', () => {
    for (const l of ['02.10.2026', '17-09-2026 12:08', '07:16', '05 Ekim 2026', '26 Sept', '5 sa önce', '5 days ago', '18°',
      'Bu sayfa en son 02 Ekim 2026 tarihinde güncellenmiştir.', 'Tarih: 16.09.2024 | Okunma sayısı: 12895']) expect(isVolatileLine(l)).toBe(true)
    for (const l of ['90 gün', '90 days', '120 days', 'Full fare: 46.20 TL', '24 saat', '3.45 %', 'Article 20: service fee']) expect(isVolatileLine(l)).toBe(false)
  })
  it('a page that only moved its clock is no change; a fare change beside it still is', () => {
    expect(comparableText('Fare 46.20 TL\n07:16\n18°')).toBe('Fare 46.20 TL')
    expect(hashOf(comparableText('Fare 46.20 TL\n07:16'))).toBe(hashOf(comparableText('Fare 46.20 TL\n07:17')))
    expect(hashOf(comparableText('Fare 46.20 TL\n07:16'))).not.toBe(hashOf(comparableText('Fare 50.80 TL\n07:16')))
  })
})

describe('the review queue entry', () => {
  const changedAt = new Date('2026-10-05T04:20:00Z')
  const posts = [
    { id: '1', slug: 'istanbulkart', title: 'Istanbulkart', lastReviewedAt: new Date('2026-09-30'), officialSources: [{ url: 'https://fare.gov.tr/p', label: 'Fares' }] },
    { id: '2', slug: 'reviewed-after', title: 'Later', lastReviewedAt: new Date('2026-10-06'), officialSources: [{ url: 'https://fare.gov.tr/p', label: 'Fares' }] },
    { id: '3', slug: 'never', title: 'Never', lastReviewedAt: null, officialSources: [{ url: 'https://fare.gov.tr/p', label: 'Fares' }] },
    { id: '4', slug: 'other', title: 'Other', lastReviewedAt: null, officialSources: [{ url: 'https://quiet.gov.tr/p', label: 'Quiet' }] },
  ]
  it('lists articles citing a changed source that were not reviewed since; a review clears it', () => {
    const out = sourceChangesForQueue(posts, [
      { url: 'https://fare.gov.tr/p', changedAt, lastDiff: '− 46.20\n+ 50.80' },
      { url: 'https://quiet.gov.tr/p', changedAt: null, lastDiff: null },
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
      { url: 'https://same.gov.tr/p' }, { url: 'https://new.gov.tr/p' }, { url: 'https://fare.gov.tr/p' }, { url: 'https://shuffle.gov.tr/p' }, { url: 'https://down.gov.tr/p' },
    ] }])
    const known = (t: string) => ({ contentHash: hashOf(t), text: t })
    p.handbookSource.findMany.mockResolvedValue([
      { url: 'https://same.gov.tr/p',    ...known('Hello') },
      { url: 'https://fare.gov.tr/p',    ...known('Full fare: 46.20 TL') },
      { url: 'https://shuffle.gov.tr/p', ...known('a\nb') },
      { url: 'https://down.gov.tr/p',    ...known('x') },
    ])
    pages = {
      'https://same.gov.tr/p':    { body: '<p>Hello</p>' },
      'https://new.gov.tr/p':     { body: '<p>First time</p>' },
      'https://fare.gov.tr/p':    { body: '<p>Full fare: 50.80 TL</p>' },
      'https://shuffle.gov.tr/p': { body: '<p>b</p><p>a</p>' },
      'https://down.gov.tr/p':    { status: 503, body: '' },
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
    expect(upserts['https://fare.gov.tr/p'].update).toMatchObject({ lastDiff: '− Full fare: 46.20 TL\n+ Full fare: 50.80 TL' })
    expect(upserts['https://fare.gov.tr/p'].update.changedAt).toBeInstanceOf(Date)
    expect(upserts['https://same.gov.tr/p'].update.changedAt).toBeUndefined()
    expect(upserts['https://shuffle.gov.tr/p'].update.changedAt).toBeUndefined()
    expect(upserts['https://new.gov.tr/p'].create.changedAt).toBeUndefined()
    expect(upserts['https://down.gov.tr/p'].update).toMatchObject({ lastStatus: 503, lastError: 'HTTP 503' })
    // An error never overwrites the last good content.
    expect(upserts['https://down.gov.tr/p'].update.contentHash).toBeUndefined()
  })
})

describe('the first sweep after the volatile-line filter', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch })
  it('does not flag a page whose stored text still carries a clock line (stored before the filter existed)', async () => {
    vi.clearAllMocks()
    p.post.findMany.mockResolvedValue([{ officialSources: [{ url: 'https://old.gov.tr/p' }] }])
    const stored = 'Fare 46.20 TL\n07:16'
    p.handbookSource.findMany.mockResolvedValue([{ url: 'https://old.gov.tr/p', contentHash: hashOf(stored), text: stored }])
    global.fetch = vi.fn(async () => new Response('<p>Fare 46.20 TL</p><p>07:41</p>', { status: 200, headers: { 'content-type': 'text/html' } })) as any
    const r = await runSourceWatch(new Date('2026-10-12T04:15:00Z'))
    expect(r.changed).toBe(0)
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
