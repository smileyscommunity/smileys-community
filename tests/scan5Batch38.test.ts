import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'

// Fifth scan, batch 38 — production audit: duplicate event_recommendations.
//   - the nightly prune never ran on its own (it was the last step of
//     sweep-event-spots) and only removed unstamped repeats older than a week
//   - concurrent first-event loads raced read-then-insert (~71 dupes a day)
// Behaviour runs against a simulated table with a real per-key advisory lock,
// so the concurrency tests fail when the lock is switched off.

const h = vi.hoisted(() => {
  type Row = {
    id: string; userId: string; eventId: string; createdAt: Date
    clickedAt: Date | null; rsvpedAt: Date | null
    score?: number; reason?: unknown; surface?: string
  }
  const BASE = Date.parse('2026-09-01T00:00:00Z')
  const s = {
    table:       [] as Row[],
    seq:         0,
    lockEnabled: true,
    calls:       [] as string[],
    lockKeys:    [] as unknown[],
    failFill:    false,
  }
  const locks = new Map<string, Promise<void>>()
  const tick = () => new Promise<void>(r => setTimeout(r, 0))
  const cmp = (a: Row, b: Row) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const matches = (r: Row, where: any): boolean => {
    if (!where) return true
    if (where.OR) return where.OR.some((w: any) => matches(r, w))
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === 'object' && 'in' in (v as any)) {
        if (!(v as any).in.includes((r as any)[k])) return false
      } else if ((r as any)[k] !== v) return false
    }
    return true
  }

  const model = {
    findMany: vi.fn(async ({ where }: any) => { s.calls.push('findMany'); await tick(); return s.table.filter(r => matches(r, where)).map(r => ({ ...r })) }),
    findFirst: vi.fn(async ({ where }: any) => { await tick(); return s.table.filter(r => matches(r, where)).sort(cmp)[0] ?? null }),
    createMany: vi.fn(async ({ data }: any) => {
      s.calls.push('createMany')
      await tick()
      for (const d of data) {
        s.seq++
        s.table.push({ id: `r${String(s.seq).padStart(5, '0')}`, createdAt: new Date(BASE + s.seq * 1000), clickedAt: null, rsvpedAt: null, ...d })
      }
      return { count: data.length }
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      await tick()
      if (s.failFill) { s.failFill = false; return { count: 0 } }
      const hit = s.table.filter(r => matches(r, where))
      hit.forEach(r => Object.assign(r, data))
      return { count: hit.length }
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      await tick()
      const before = s.table.length
      s.table = s.table.filter(r => !matches(r, where))
      return { count: before - s.table.length }
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
        .sort((a, b) => a.userId.localeCompare(b.userId) || a.eventId.localeCompare(b.eventId))
      return (take ? dup.slice(0, take) : dup).map(g => ({ userId: g.userId, eventId: g.eventId, _count: { _all: g.n } }))
    }),
    count: vi.fn(async () => s.table.length),
  }

  type Ctx = { held: (() => void)[] }
  const raw = async (ctx: Ctx | null, strings: TemplateStringsArray, values: any[]) => {
    const sql = strings.join('$')
    if (sql.includes('pg_advisory_xact_lock')) {
      s.calls.push('lock')
      s.lockKeys.push(values[0])
      if (!ctx) throw new Error('advisory xact lock outside a transaction')
      if (!s.lockEnabled) return [{ locked: 1 }]
      const key = String(values[0])
      const prev = locks.get(key) ?? Promise.resolve()
      let release!: () => void
      const mine = new Promise<void>(r => { release = r })
      locks.set(key, prev.then(() => mine))
      await prev
      ctx.held.push(release)
      return [{ locked: 1 }]
    }
    if (sql.includes('FOR UPDATE')) {
      s.calls.push('lockRead')
      if (!ctx) throw new Error('FOR UPDATE outside a transaction')
      const [userIds, eventIds] = values as [string[], string[]]
      await tick()
      return s.table.filter(r => userIds.includes(r.userId) && eventIds.includes(r.eventId)).map(r => ({ ...r }))
    }
    throw new Error(`unexpected raw SQL: ${sql}`)
  }

  const client = (ctx: Ctx | null): any => ({
    eventRecommendation: model,
    $queryRaw: (strings: TemplateStringsArray, ...values: any[]) => raw(ctx, strings, values),
  })
  const prisma = {
    ...client(null),
    $transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const ctx: Ctx = { held: [] }
      try { return await fn(client(ctx)) }
      finally { ctx.held.forEach(r => r()) }
    }),
  }

  const reset = () => {
    s.table = []; s.seq = 0; s.lockEnabled = true; s.calls = []; s.lockKeys = []; s.failFill = false
    locks.clear()
  }
  const seed = (id: string, userId: string, eventId: string, minute: number, stamps: { clickedAt?: Date; rsvpedAt?: Date } = {}) => {
    s.table.push({ id, userId, eventId, createdAt: new Date(BASE + minute * 60_000), clickedAt: stamps.clickedAt ?? null, rsvpedAt: stamps.rsvpedAt ?? null })
  }

  return {
    s, prisma, model, reset, seed, BASE,
    getSession:     vi.fn(async () => ({ id: 'u1' })),
    recs:           vi.fn(async () => [] as any[]),
    recordCronRun:  vi.fn(async () => undefined),
  }
})

vi.mock('@/lib/prisma',     () => ({ prisma: h.prisma }))
vi.mock('@/lib/session',    () => ({ getSession: h.getSession }))
vi.mock('@/lib/cronAuth',   () => ({ checkCronAuth: vi.fn(() => null) }))
vi.mock('@/lib/cronHealth', () => ({ recordCronRun: h.recordCronRun }))
vi.mock('@/lib/firstEvent', () => ({ getFirstEventRecommendations: h.recs }))

import {
  logRecommendations, stampRecommendation, planRecommendationPrune, pruneDuplicateRecommendations,
  RECOMMENDATION_LOCK_PREFIX, PRUNE_DELETE_CHUNK,
} from '@/lib/eventRecommendations'
import { GET as firstEvent } from '@/app/api/first-event/route'
import { POST as click } from '@/app/api/first-event/[id]/click/route'
import { POST as cron } from '@/app/api/cron/sweep-recommendation-dupes/route'
import { summarizePrunePlan } from '@/scripts/prune-duplicate-recommendations'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const card = (id: string) => ({ id, score: 1, reason: { why: id } })
const rowsFor = (userId: string, eventId: string) => h.s.table.filter(r => r.userId === userId && r.eventId === eventId)
const at = (minute: number) => new Date(h.BASE + minute * 60_000)

beforeEach(() => {
  vi.clearAllMocks()
  h.reset()
})

// ── writer ───────────────────────────────────────────────────────────────────

describe('logRecommendations: serialized per member, inserts only missing keys', () => {
  it('takes the per-member lock before reading, and skips a key logged long ago', async () => {
    h.seed('old', 'u1', 'e1', -3 * 24 * 60)   // three days old — the 24h window re-logged this
    const wrote = await logRecommendations('u1', [card('e1'), card('e2'), card('e2')])
    expect(wrote).toBe(1)
    expect(h.s.lockKeys).toEqual([`${RECOMMENDATION_LOCK_PREFIX}u1`])
    expect(h.s.calls).toEqual(['lock', 'findMany', 'createMany'])
    expect(rowsFor('u1', 'e1').map(r => r.id)).toEqual(['old'])
    expect(rowsFor('u1', 'e2')).toHaveLength(1)
  })

  it('writes nothing when every key exists', async () => {
    h.seed('a', 'u1', 'e1', 0)
    expect(await logRecommendations('u1', [card('e1')])).toBe(0)
    expect(h.model.createMany).not.toHaveBeenCalled()
  })

  it('concurrent writers for one member produce one row per key', async () => {
    await Promise.all(Array.from({ length: 5 }, () => logRecommendations('u1', [card('e1'), card('e2'), card('e3')])))
    expect(h.s.table).toHaveLength(3)
    for (const e of ['e1', 'e2', 'e3']) expect(rowsFor('u1', e)).toHaveLength(1)
  })

  it('control: without the lock the same interleaving duplicates (the prod race)', async () => {
    h.s.lockEnabled = false
    await Promise.all(Array.from({ length: 5 }, () => logRecommendations('u1', [card('e1'), card('e2'), card('e3')])))
    expect(h.s.table.length).toBeGreaterThan(3)
  })

  it('two concurrent GET /api/first-event loads log each card once', async () => {
    h.recs.mockResolvedValue([card('e1'), card('e2')])
    const req = () => new Request('http://localhost/app/api/first-event?limit=3') as any
    const [a, b] = await Promise.all([firstEvent(req()), firstEvent(req())])
    expect((await a.json()).events).toHaveLength(2)
    expect((await b.json()).events).toHaveLength(2)
    expect(h.s.table).toHaveLength(2)
  })

  it('a logging failure never breaks the member surface', async () => {
    h.recs.mockResolvedValue([card('e1')])
    h.prisma.$transaction.mockRejectedValueOnce(new Error('db down'))
    const res = await firstEvent(new Request('http://localhost/app/api/first-event') as any)
    expect(res.status).toBe(200)
    expect((await res.json()).events).toHaveLength(1)
  })
})

// ── stamps ───────────────────────────────────────────────────────────────────

describe('stamps land on the keeper (the earliest row)', () => {
  it('the click beacon stamps the earliest row, and a second click keeps the first', async () => {
    h.seed('keep', 'u1', 'e1', 0)
    h.seed('late', 'u1', 'e1', 60)
    const ctx = { params: Promise.resolve({ id: 'e1' }) }
    await click(new Request('http://localhost') as any, ctx)
    const first = rowsFor('u1', 'e1').find(r => r.id === 'keep')!.clickedAt
    expect(first).toBeInstanceOf(Date)
    expect(rowsFor('u1', 'e1').find(r => r.id === 'late')!.clickedAt).toBeNull()

    expect(await stampRecommendation('u1', 'e1', 'clickedAt')).toBe(false)
    expect(rowsFor('u1', 'e1').find(r => r.id === 'keep')!.clickedAt).toBe(first)

    // The prune removes 'late' and the click survives.
    await pruneDuplicateRecommendations()
    expect(rowsFor('u1', 'e1')).toEqual([expect.objectContaining({ id: 'keep', clickedAt: first })])
  })

  it('RSVP attribution delegates to the same keeper stamp', () => {
    const src = read('lib/firstEvent.ts')
    expect(src).toMatch(/stampFirstEventRsvp[\s\S]*?await stampRecommendation\(userId, eventId, 'rsvpedAt'\)/)
    expect(src).not.toMatch(/eventRecommendation\.(update|create)/)
  })
})

// ── prune ────────────────────────────────────────────────────────────────────

describe('pruneDuplicateRecommendations', () => {
  const seedMixed = () => {
    // A: plain repeats — earliest stays
    h.seed('a1', 'u1', 'eA', 0); h.seed('a2', 'u1', 'eA', 10); h.seed('a3', 'u1', 'eA', 20)
    // B: unstamped keeper, stamped losers — stamps fold in, earliest click wins
    h.seed('b1', 'u1', 'eB', 0)
    h.seed('b2', 'u1', 'eB', 10, { clickedAt: at(15) })
    h.seed('b3', 'u1', 'eB', 20, { clickedAt: at(25), rsvpedAt: at(30) })
    // C: keeper already clicked later than a loser — keeper's stamp is not rewritten
    h.seed('c1', 'u2', 'eC', 0, { clickedAt: at(50) })
    h.seed('c2', 'u2', 'eC', 5, { clickedAt: at(6) })
    // D: createdAt tie — lower id stays
    h.seed('d9', 'u2', 'eD', 0); h.seed('d1', 'u2', 'eD', 0)
    // E: single row, and another member's same event
    h.seed('e1', 'u3', 'eA', 0)
  }

  it('keeps the earliest row per (member, event) and folds stamps before deleting', async () => {
    seedMixed()
    const r = await pruneDuplicateRecommendations()
    expect(r).toMatchObject({ groups: 4, deleted: 6, filled: 1, skipped: 0, done: true })
    const ids = h.s.table.map(x => x.id).sort()
    expect(ids).toEqual(['a1', 'b1', 'c1', 'd1', 'e1'])
    const b1 = h.s.table.find(x => x.id === 'b1')!
    expect(b1.clickedAt).toEqual(at(15))
    expect(b1.rsvpedAt).toEqual(at(30))
    expect(h.s.table.find(x => x.id === 'c1')!.clickedAt).toEqual(at(50))
  })

  it('locks the rows it plans from, inside the transaction', async () => {
    seedMixed()
    await pruneDuplicateRecommendations()
    expect(h.s.calls).toContain('lockRead')
  })

  it('is idempotent — a second run finds nothing', async () => {
    seedMixed()
    await pruneDuplicateRecommendations()
    const after = h.s.table.map(x => ({ ...x }))
    const r = await pruneDuplicateRecommendations()
    expect(r).toMatchObject({ deleted: 0, groups: 0, done: true, batches: 0 })
    expect(h.s.table).toEqual(after)
  })

  it('never deletes a stamped loser when its stamp could not be folded in', async () => {
    h.seed('k', 'u1', 'e1', 0)
    h.seed('l', 'u1', 'e1', 10, { rsvpedAt: at(11) })
    h.s.failFill = true
    const r = await pruneDuplicateRecommendations()
    expect(r).toMatchObject({ deleted: 0, skipped: 1, done: false })
    expect(h.s.table.map(x => x.id).sort()).toEqual(['k', 'l'])
  })

  it('works through many groups in batches, deleting in bounded chunks', async () => {
    for (let g = 0; g < 5; g++) for (let i = 0; i < 3; i++) h.seed(`g${g}-${i}`, `u${g}`, 'e', i)
    for (let i = 0; i <= PRUNE_DELETE_CHUNK; i++) h.seed(`big${String(i).padStart(5, '0')}`, 'uBig', 'e', i)
    const r = await pruneDuplicateRecommendations({ pairsPerBatch: 2 })
    expect(r.done).toBe(true)
    expect(r.batches).toBe(3)
    expect(r.deleted).toBe(5 * 2 + PRUNE_DELETE_CHUNK)
    expect(h.s.table).toHaveLength(6)
    for (const c of h.model.deleteMany.mock.calls) expect((c[0] as any).where.id.in.length).toBeLessThanOrEqual(PRUNE_DELETE_CHUNK)
  })

  it('stops at the time budget and reports it is not done', async () => {
    for (let g = 0; g < 4; g++) { h.seed(`x${g}a`, `u${g}`, 'e', 0); h.seed(`x${g}b`, `u${g}`, 'e', 1) }
    let t = 0
    const r = await pruneDuplicateRecommendations({ pairsPerBatch: 1, budgetMs: 45_000, now: () => (t += 30_000) })
    expect(r.done).toBe(false)
    expect(r.batches).toBe(1)
    expect(h.s.table).toHaveLength(7)
  })

  it('planner omits single-row pairs and orders ties by id', () => {
    const plans = planRecommendationPrune([
      { id: 'z', userId: 'u', eventId: 'e', createdAt: at(0), clickedAt: null, rsvpedAt: null },
      { id: 'a', userId: 'u', eventId: 'e', createdAt: at(0), clickedAt: null, rsvpedAt: null },
      { id: 'solo', userId: 'u', eventId: 'f', createdAt: at(0), clickedAt: null, rsvpedAt: null },
    ])
    expect(plans).toEqual([{ userId: 'u', eventId: 'e', keeperId: 'a', loserIds: ['z'], fill: {} }])
  })
})

// ── cron ─────────────────────────────────────────────────────────────────────

describe('sweep-recommendation-dupes cron', () => {
  it('prunes and records its own run', async () => {
    h.seed('k', 'u1', 'e1', 0); h.seed('l', 'u1', 'e1', 1)
    const res = await cron(new Request('http://localhost', { method: 'POST' }) as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, deleted: 1, done: true })
    expect(h.recordCronRun).toHaveBeenCalledWith('sweep-recommendation-dupes', true)
  })

  it('records a failure and answers 500', async () => {
    h.model.groupBy.mockRejectedValueOnce(new Error('boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await cron(new Request('http://localhost', { method: 'POST' }) as any)
    err.mockRestore()
    expect(res.status).toBe(500)
    expect(h.recordCronRun).toHaveBeenCalledWith('sweep-recommendation-dupes', false, expect.any(Error))
  })

  it('deploy.sh registers it idempotently inside the sweeper heredoc', () => {
    const deploy = read('deploy.sh')
    const start = deploy.indexOf('echo "→ Registering sweeper crontabs..."')
    const end   = deploy.indexOf('\nEOF\n', start)
    expect(start).toBeGreaterThan(-1)
    const block = deploy.slice(start, end)
    const lines = block.split('\n').filter(l => l.includes('sweep-recommendation-dupes'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe(
      "chmod +x $REMOTE/scripts/sweep-recommendation-dupes.sh; (crontab -l 2>/dev/null | grep -v 'sweep-recommendation-dupes' ; " +
      "echo '47 3 * * * $REMOTE/scripts/sweep-recommendation-dupes.sh >> /var/log/sweep-recommendation-dupes.log 2>&1') | crontab -; " +
      "echo '  ✓ recommendation-dupes'",
    )
  })

  it('the wrapper POSTs to the route with the secret read from .env', () => {
    const sh = read('scripts/sweep-recommendation-dupes.sh')
    expect(statSync(join(__dirname, '..', 'scripts/sweep-recommendation-dupes.sh')).mode & 0o111).not.toBe(0)
    expect(sh).toContain('http://localhost:3000/app/api/cron/sweep-recommendation-dupes')
    expect(existsSync(join(__dirname, '..', 'app/api/cron/sweep-recommendation-dupes/route.ts'))).toBe(true)
    expect(sh).toContain("grep -E '^CRON_SECRET=' \"$ENV_FILE\"")
    expect(sh).toContain('-X POST')
    expect(sh).toContain('-H "Authorization: Bearer $SECRET"')
    expect(sh).toContain('-H "Origin: $ORIGIN"')
  })

  it('the staleness monitor knows the name, and event-spots no longer carries the prune', () => {
    expect(read('lib/cronHealth.ts')).toContain("'sweep-recommendation-dupes': 24 * 60")
    expect(read('app/api/cron/sweep-event-spots/route.ts')).not.toContain('event_recommendations r')
  })
})

// ── script ───────────────────────────────────────────────────────────────────

describe('prune script planner', () => {
  it('counts every group, not just the sample', () => {
    const rows = []
    for (let g = 0; g < 30; g++) {
      rows.push({ id: `k${g}`, userId: `u${g}`, eventId: 'e', createdAt: at(0), clickedAt: null, rsvpedAt: null })
      for (let i = 1; i <= 3; i++) rows.push({ id: `l${g}-${i}`, userId: `u${g}`, eventId: 'e', createdAt: at(i), clickedAt: g === 0 && i === 2 ? at(9) : null, rsvpedAt: null })
    }
    rows.push({ id: 'solo', userId: 'uS', eventId: 'e', createdAt: at(0), clickedAt: null, rsvpedAt: null })
    const s = summarizePrunePlan(planRecommendationPrune(rows), rows)
    expect(s).toMatchObject({ groups: 30, rowsInGroups: 120, rowsToDelete: 90, rowsKept: 30, stampFills: 1, stampedLosers: 1 })
    expect(s.sample).toHaveLength(20)
  })

  it('APPLY runs the same batched prune as the cron; dry run is the default', () => {
    const src = read('scripts/prune-duplicate-recommendations.ts')
    expect(src).toContain("const APPLY = process.env.APPLY === '1'")
    expect(src).toMatch(/if \(!APPLY\) \{[\s\S]*?return\s*\}\s*const r = await pruneDuplicateRecommendations\(/)
  })
})
