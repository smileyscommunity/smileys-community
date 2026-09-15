import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Sixth scan, batch 20 — two low-severity follow-ups:
//   27) event_recommendations has had a UNIQUE (userId, eventId) index since
//       migration 20260914000001. logRecommendations' insert now skips
//       duplicates, so a writer that skips the lock can't 500 on P2002. The
//       nightly prune route is kept but answers from the catalog while the
//       index holds, instead of running a whole-table GROUP BY.
//   28) repair-dead-notification-links treated any -N (N ≤ 999) as a
//       duplicate counter, so a removed `istanbul-in-48` would have been
//       rewritten to a live `istanbul-in`. It now takes only -1..-9, and only
//       when the link is newer than the original post.

const h = vi.hoisted(() => {
  type Row = { id: string; userId: string; eventId: string; createdAt: Date; clickedAt: Date | null; rsvpedAt: Date | null }
  const s = { table: [] as Row[], indexed: false, sql: [] as string[], seq: 0 }
  const BASE = Date.parse('2026-09-01T00:00:00Z')
  const same = (r: Row, d: { userId: string; eventId: string }) => r.userId === d.userId && r.eventId === d.eventId
  const insert = (userId: string, eventId: string) => {
    s.seq++
    s.table.push({ id: `r${String(s.seq).padStart(4, '0')}`, userId, eventId, createdAt: new Date(BASE + s.seq * 1000), clickedAt: null, rsvpedAt: null })
  }

  const model = {
    findMany: vi.fn(async ({ where }: any) => s.table.filter(r => r.userId === where.userId && where.eventId.in.includes(r.eventId)).map(r => ({ eventId: r.eventId }))),
    // Behaves like the unique index: a clash throws P2002 unless skipDuplicates.
    createMany: vi.fn(async ({ data, skipDuplicates }: any) => {
      let count = 0
      for (const d of data) {
        if (s.table.some(r => same(r, d))) {
          if (!skipDuplicates) throw Object.assign(new Error('Unique constraint failed on (userId, eventId)'), { code: 'P2002' })
          continue
        }
        insert(d.userId, d.eventId)
        count++
      }
      return { count }
    }),
    groupBy: vi.fn(async ({ take }: any) => {
      const by = new Map<string, { userId: string; eventId: string; n: number }>()
      for (const r of s.table) {
        const k = `${r.userId} ${r.eventId}`
        const g = by.get(k) ?? { userId: r.userId, eventId: r.eventId, n: 0 }
        g.n++
        by.set(k, g)
      }
      const dup = [...by.values()].filter(g => g.n > 1)
      return (take ? dup.slice(0, take) : dup).map(g => ({ userId: g.userId, eventId: g.eventId, _count: { _all: g.n } }))
    }),
    updateMany: vi.fn(async () => ({ count: 0 })),
    deleteMany: vi.fn(async ({ where }: any) => {
      const before = s.table.length
      s.table = s.table.filter(r => !where.id.in.includes(r.id))
      return { count: before - s.table.length }
    }),
  }

  const raw = async (strings: TemplateStringsArray, ...values: any[]) => {
    const sql = strings.join('$')
    s.sql.push(sql)
    if (sql.includes('pg_advisory_xact_lock')) return [{ locked: 1 }]
    if (sql.includes('pg_index')) return s.indexed ? [{ ok: 1 }] : []
    if (sql.includes('FOR UPDATE')) {
      const [userIds, eventIds] = values as [string[], string[]]
      return s.table.filter(r => userIds.includes(r.userId) && eventIds.includes(r.eventId)).map(r => ({ ...r }))
    }
    if (sql.includes('EXISTS')) {
      const seen = new Set<string>()
      for (const r of s.table) {
        const k = `${r.userId} ${r.eventId}`
        if (seen.has(k)) return [{ dup: 1 }]
        seen.add(k)
      }
      return []
    }
    throw new Error(`unexpected raw SQL: ${sql}`)
  }

  const client = { eventRecommendation: model, $queryRaw: raw }
  const prisma = { ...client, $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(client)) }
  const reset = () => { s.table = []; s.indexed = false; s.sql = []; s.seq = 0 }
  return { s, model, prisma, insert, reset, recordCronRun: vi.fn(async () => undefined) }
})

vi.mock('@/lib/prisma',     () => ({ prisma: h.prisma }))
vi.mock('@/lib/cronAuth',   () => ({ checkCronAuth: vi.fn(() => null) }))
vi.mock('@/lib/cronHealth', () => ({ recordCronRun: h.recordCronRun }))

import { logRecommendations, RECOMMENDATION_UNIQUE_INDEX } from '@/lib/eventRecommendations'
import { POST as cron } from '@/app/api/cron/sweep-recommendation-dupes/route'
import {
  originalPostSlug, classifyLink, referencedKeys, planLinkRepairs, linkRepairWrites, type ExistenceIndex,
} from '@/scripts/repair-dead-notification-links'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const card = (id: string) => ({ id, score: 1, reason: { why: id } })
const post = () => cron(new Request('http://localhost', { method: 'POST' }) as any)
const tableScans = () => h.s.sql.filter(q => /FROM event_recommendations/.test(q))

beforeEach(() => {
  vi.clearAllMocks()
  h.reset()
})

// ── 27 — recommendations writer + prune cron ────────────────────────────────

describe('27 — logRecommendations inserts with skipDuplicates', () => {
  it('passes skipDuplicates: true to createMany', async () => {
    expect(await logRecommendations('u1', [card('e1'), card('e2')])).toBe(2)
    expect(h.model.createMany).toHaveBeenCalledTimes(1)
    expect(h.model.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true })
  })

  it('a pair inserted outside the lock between read and insert is skipped, not a P2002', async () => {
    h.model.findMany.mockImplementationOnce(async () => {
      h.insert('u1', 'e1')   // another writer lands after our read
      return []
    })
    await expect(logRecommendations('u1', [card('e1'), card('e2')])).resolves.toBe(1)
    expect(h.s.table.filter(r => r.eventId === 'e1')).toHaveLength(1)
  })

  it('the header describes the index + lock, not a missing index', () => {
    const src = read('lib/eventRecommendations.ts')
    expect(src).not.toMatch(/no unique index exists/)
    expect(src).not.toMatch(/Nothing here depends on it/)
    expect(src).toContain('belt-and-braces')
    expect(src).toMatch(/createMany\(\{[\s\S]*?skipDuplicates: true,[\s\S]*?\}\)/)
  })

  it('the index name the catalog check looks for is the one the migration creates', () => {
    expect(read('prisma/migrations/20260914000001_recommendation_unique/migration.sql'))
      .toContain(`CREATE UNIQUE INDEX "${RECOMMENDATION_UNIQUE_INDEX}" ON "event_recommendations"("userId", "eventId")`)
    expect(read('prisma/schema.prisma')).toMatch(/model EventRecommendation \{[\s\S]*?@@unique\(\[userId, eventId\]\)/)
  })
})

describe('27 — sweep-recommendation-dupes is a no-op unless a duplicate exists', () => {
  it('with a valid unique index: answers from the catalog, never reads the table', async () => {
    h.s.indexed = true
    h.insert('u1', 'e1'); h.insert('u2', 'e1')
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, indexed: true, duplicates: false, groups: 0, deleted: 0, filled: 0, skipped: 0, batches: 0, done: true })
    expect(tableScans()).toHaveLength(0)
    expect(h.model.groupBy).not.toHaveBeenCalled()
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
    expect(h.recordCronRun).toHaveBeenCalledWith('sweep-recommendation-dupes', true)
  })

  it('without the index and no duplicate: one LIMIT 1 existence check, no GROUP BY', async () => {
    h.insert('u1', 'e1'); h.insert('u1', 'e2')
    const res = await post()
    expect(await res.json()).toMatchObject({ ok: true, indexed: false, duplicates: false, deleted: 0, done: true })
    expect(tableScans()).toHaveLength(1)
    expect(tableScans()[0]).toMatch(/EXISTS[\s\S]*LIMIT 1/)
    expect(h.model.groupBy).not.toHaveBeenCalled()
    expect(h.recordCronRun).toHaveBeenCalledWith('sweep-recommendation-dupes', true)
  })

  it('without the index and a duplicate present: still prunes it', async () => {
    h.insert('u1', 'e1'); h.insert('u1', 'e1'); h.insert('u2', 'e1')
    const res = await post()
    expect(await res.json()).toMatchObject({ ok: true, indexed: false, duplicates: true, groups: 1, deleted: 1, done: true })
    expect(h.s.table.map(r => r.id)).toEqual(['r0001', 'r0003'])
    expect(h.model.groupBy).toHaveBeenCalled()
  })

  it('a failing check is recorded as a failed run', async () => {
    const realRaw = h.prisma.$queryRaw
    h.prisma.$queryRaw = (async () => { throw new Error('catalog down') }) as any
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await post()
      expect(res.status).toBe(500)
      expect(h.recordCronRun).toHaveBeenCalledWith('sweep-recommendation-dupes', false, expect.any(Error))
    } finally {
      err.mockRestore()
      h.prisma.$queryRaw = realRaw
    }
  })

  it('kept, not retired: the cron line and the staleness entry stay', () => {
    expect(read('deploy.sh')).toContain("echo '47 3 * * * $REMOTE/scripts/sweep-recommendation-dupes.sh")
    expect(read('lib/cronHealth.ts')).toContain("'sweep-recommendation-dupes': 24 * 60")
    const route = read('app/api/cron/sweep-recommendation-dupes/route.ts')
    expect(route).toMatch(/await hasDuplicateRecommendations\(\)[\s\S]*?if \(!duplicates\) \{[\s\S]*?return[\s\S]*?pruneDuplicateRecommendations\(/)
  })
})

// ── 28 — duplicate post-slug rewrite ────────────────────────────────────────

describe('28 — only a real -1..-9 duplicate counter maps to the original post', () => {
  const orig = 'scams-tourist-traps-in-t-rkiye-how-to-stay-safe-without-becoming-paranoid'
  const dup  = `${orig}-1`
  const ORIG_AT = new Date('2026-05-01T09:00:00Z')
  const idx = (slugs: string[], dates: Record<string, Date> = {}): ExistenceIndex => ({
    keys: { 'post.slug': new Set(slugs) },
    clubSlugById: new Map(),
    postCreatedAtBySlug: new Map(Object.entries(dates)),
  })

  it('originalPostSlug: -1..-9 only', () => {
    for (let n = 1; n <= 9; n++) expect(originalPostSlug(`guide-${n}`)).toBe('guide')
    expect(originalPostSlug('istanbul-in-48')).toBeNull()
    expect(originalPostSlug('top-10')).toBeNull()
    expect(originalPostSlug('guide-0')).toBeNull()
    expect(originalPostSlug('guide-1a')).toBeNull()
  })

  it('negative: a removed `istanbul-in-48` is DEAD though `istanbul-in` exists, and the base is never looked up', () => {
    const index = idx(['istanbul-in'], { 'istanbul-in': ORIG_AT })
    for (const base of ['/posts', '/handbook']) {
      expect(classifyLink(`${base}/istanbul-in-48`, index, new Date('2026-09-01T00:00:00Z'))).toMatchObject({ status: 'DEAD', newLink: null })
    }
    expect([...referencedKeys(['/posts/istanbul-in-48']).get('post.slug')!]).toEqual(['istanbul-in-48'])
  })

  it('the base must exist exactly, not just by prefix', () => {
    expect(classifyLink('/posts/istanbul-in-2', idx(['istanbul-in-two', 'istanbul']))).toMatchObject({ status: 'DEAD' })
  })

  it('a link newer than the original is REWRITABLE (the 1,198-link case)', () => {
    const v = classifyLink(`/posts/${dup}`, idx([orig], { [orig]: ORIG_AT }), new Date('2026-09-10T12:00:00Z'))
    expect(v).toMatchObject({ status: 'REWRITABLE', newLink: `/posts/${orig}` })
  })

  it('a link older than the original was never about its copy → DEAD', () => {
    const v = classifyLink(`/posts/${dup}`, idx([orig], { [orig]: ORIG_AT }), new Date('2026-04-30T09:00:00Z'))
    expect(v).toMatchObject({ status: 'DEAD', newLink: null })
  })

  it('without dates it falls back to slug shape + exact existence', () => {
    expect(classifyLink(`/posts/${dup}`, idx([orig])).status).toBe('REWRITABLE')
    expect(classifyLink(`/posts/${dup}`, idx([orig], { [orig]: ORIG_AT })).status).toBe('REWRITABLE')
  })

  it('planLinkRepairs decides per row for the same link, and writes accordingly', () => {
    const index = idx([orig], { [orig]: ORIG_AT })
    const rows = [
      ...Array.from({ length: 1198 }, (_, i) => ({ id: `new${i}`, link: `/handbook/${dup}`, createdAt: new Date(Date.parse('2026-06-01T00:00:00Z') + i * 60_000) })),
      { id: 'old', link: `/handbook/${dup}`, createdAt: new Date('2026-01-01T00:00:00Z') },
    ]
    const plan = planLinkRepairs(rows, index)
    expect(plan.filter(p => p.status === 'REWRITABLE')).toHaveLength(1198)
    expect(plan.find(p => p.id === 'old')).toMatchObject({ status: 'DEAD', newLink: null })
    const writes = linkRepairWrites(plan)
    expect(writes).toHaveLength(1199)
    expect(writes.find(w => w.id === 'old')).toEqual({ id: 'old', oldLink: `/handbook/${dup}`, newLink: null })
    expect(writes.find(w => w.id === 'new0')).toEqual({ id: 'new0', oldLink: `/handbook/${dup}`, newLink: `/handbook/${orig}` })
  })

  it('the script loads each post\'s createdAt into the index', () => {
    const src = read('scripts/repair-dead-notification-links.ts')
    expect(src).toMatch(/prisma\.post\.findMany\(\{ where: \{ slug: \{ in: k \} \}, select: \{ slug: true, createdAt: true \} \}\)/)
    expect(src).toMatch(/index\.postCreatedAtBySlug!\.set\(p\.slug, p\.createdAt\)/)
  })
})
