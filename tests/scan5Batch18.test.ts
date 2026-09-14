import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'

// Scan 5, batch 18:
//   61 — a deleted DM kept showing through the quote chip of any reply to it,
//        and could still be picked as a reply target.
//   69 — the neighborhood wall's expanded reply list ignored new and deleted
//        replies, and a failed "Show all" load stuck on "Loading…".
//   70 — the directory map pinned other cities' businesses on Istanbul
//        neighborhoods that happen to share their name.

vi.mock('@/lib/session',   () => ({ getSession: vi.fn() }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(async () => true) }))
vi.mock('@/lib/access',    () => ({ isAdminOrModerator: () => false, isClubHost: vi.fn(async () => false) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    memberBlock:      { findFirst: vi.fn() },
    memberConnection: { findFirst: vi.fn() },
    user:             { findUnique: vi.fn() },
    notification:     { findFirst: vi.fn() },
    directMessage:    { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
}))

import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '@/app/api/messages/[userId]/route'

const read = (p: string) => readFileSync(p, 'utf-8')
const p = prisma as any
const me = { id: 'u-b', name: 'B', role: 'member' }
const params = { params: Promise.resolve({ userId: 'u-a' }) } as never
const from = { id: 'u-a', name: 'A' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue(me)
  p.memberBlock.findFirst.mockResolvedValue(null)
  p.memberConnection.findFirst.mockResolvedValue({ id: 'conn' })
  p.user.findUnique.mockResolvedValue({ id: 'u-a', name: 'A' })
  p.notification.findFirst.mockResolvedValue({ id: 'n' })
  p.directMessage.updateMany.mockResolvedValue({ count: 0 })
})

describe('61 deleted DMs stay deleted inside quotes', () => {
  it('GET nulls the text and photo of a deleted quote and flags it', async () => {
    // fetched desc for the initial load
    p.directMessage.findMany.mockResolvedValue([
      { id: 'm3', text: 'reply 2', replyTo: { id: 'm0', text: 'still here', imageUrl: null, deletedAt: null, from } },
      { id: 'm2', text: 'reply 1', replyTo: { id: 'm1', text: 'secret', imageUrl: '/app/api/files/messages/a.jpg', deletedAt: new Date(), from } },
    ])
    const res = await GET(new Request('https://x/app/api/messages/u-a') as never, params)
    const body = await res.json()
    expect(body.map((m: any) => m.id)).toEqual(['m2', 'm3'])
    expect(body[0].replyTo).toEqual({ id: 'm1', text: null, imageUrl: null, deleted: true, from })
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(body[1].replyTo).toEqual({ id: 'm0', text: 'still here', imageUrl: null, from })
    // the query has to fetch deletedAt for the redaction to see it
    expect(p.directMessage.findMany.mock.calls[0][0].include.replyTo.select.deletedAt).toBe(true)
  })

  const post = (body: unknown) =>
    POST(new Request('https://x/app/api/messages/u-a', { method: 'POST', body: JSON.stringify(body) }) as never, params)

  it('POST refuses a deleted reply target with 400 and creates nothing', async () => {
    p.directMessage.findUnique.mockResolvedValue({ fromId: 'u-a', toId: 'u-b', deletedAt: new Date() })
    const res = await post({ text: 'hi', replyToId: 'm1' })
    expect(res.status).toBe(400)
    expect(p.directMessage.create).not.toHaveBeenCalled()
  })

  it('POST refuses a reply target from another conversation', async () => {
    p.directMessage.findUnique.mockResolvedValue({ fromId: 'u-a', toId: 'u-other', deletedAt: null })
    expect((await post({ text: 'hi', replyToId: 'm1' })).status).toBe(400)
    expect(p.directMessage.create).not.toHaveBeenCalled()
  })

  it('POST still accepts a live in-thread reply target', async () => {
    p.directMessage.findUnique.mockResolvedValue({ fromId: 'u-a', toId: 'u-b', deletedAt: null })
    p.directMessage.create.mockResolvedValue({
      id: 'm9', text: 'hi', replyTo: { id: 'm1', text: 'hello', imageUrl: null, deletedAt: null, from },
    })
    const res = await post({ text: 'hi', replyToId: 'm1' })
    expect(res.status).toBe(200)
    expect(p.directMessage.create.mock.calls[0][0].data.replyToId).toBe('m1')
    expect((await res.json()).replyTo).toEqual({ id: 'm1', text: 'hello', imageUrl: null, from })
  })

  it('the thread page renders a deleted quote as "Message deleted"', () => {
    const src = read('app/(member)/messages/[userId]/page.tsx')
    expect(src).toMatch(/\{msg\.replyTo\.deleted \? \(\s*<p[^>]*>Message deleted<\/p>/)
  })
})

describe('69 neighborhood wall expanded replies', () => {
  const src = read('components/NeighborhoodWall.tsx')
  const fn = (name: string) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf('\n  }\n', src.indexOf(`async function ${name}(`)))

  it('a posted reply joins the expanded list', () => {
    expect(fn('submitReply')).toMatch(/onReply\(post\.id, r\)\s*(\/\/.*\s*)*setAllReplies\(prev => prev \? \[\.\.\.prev, r\] : prev\)/)
  })
  it('a deleted reply leaves the expanded list', () => {
    expect(fn('deleteReply')).toMatch(/setAllReplies\(prev => prev \? prev\.filter\(r => r\.id !== replyId\) : prev\)/)
  })
  it('a failed "Show all" load resets and tells the member', () => {
    const load = fn('loadAllReplies')
    expect(load).toMatch(/try \{[\s\S]*if \(!res\.ok\) throw[\s\S]*\} catch \{[\s\S]*toast\.error\(/)
    expect(load).toMatch(/finally \{\s*setLoadingReplies\(false\)/)
    expect(src).toMatch(/onClick=\{loadAllReplies\}/)
  })
})

// Source pins on the placement logic, which moved out of the .tsx into
// lib/directoryMapPosition (scan 6 batch 12 also tests it directly).
describe('70 directory map neighborhood fallback', () => {
  const src = read('lib/directoryMapPosition.ts')
  const start = src.indexOf('function resolvePosition(')
  const fn = src.slice(start, src.indexOf('\n}\n', start))

  it('own coordinates are checked first, before any fallback', () => {
    expect(fn.indexOf('b.latitude != null && b.longitude != null')).toBeGreaterThan(-1)
    expect(fn.indexOf('b.latitude != null')).toBeLessThan(fn.indexOf('NEIGHBORHOOD_META'))
  })
  it('the NEIGHBORHOOD_META fallback is gated on the default city', () => {
    expect(fn).toMatch(/if \(b\.neighborhood && b\.citySlug === DEFAULT_CITY_SLUG\) \{\s*const meta = NEIGHBORHOOD_META\[b\.neighborhood\]/)
    // exactly one lookup, and it sits inside the gate
    expect(fn.match(/NEIGHBORHOOD_META\[/g)).toHaveLength(1)
  })
  it('an unknown city gets no fallback (citySlug is optional, never defaulted)', () => {
    expect(src).toMatch(/citySlug\?: string \| null/)
    expect(fn).not.toMatch(/citySlug \?\?|!b\.citySlug/)
  })
  it('its default-city slug matches lib/city', () => {
    const slug = read('lib/city.ts').match(/export const DEFAULT_CITY_SLUG = '([^']+)'/)?.[1]
    expect(slug).toBeTruthy()
    expect(src).toContain(`const DEFAULT_CITY_SLUG = '${slug}'`)
  })
})
