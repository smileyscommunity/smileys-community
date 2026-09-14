import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, item 84 and the comms parts of 85: @mentions that broke on
// non-ASCII first letters (and fanned "@Ayşe" out to every "Ay…"), a
// broadcast edit that rewrote other sends' notifications, broadcast history
// scoping for moderators, and a login-nudge tool that double-sent.
const read = (f: string) => readFileSync(f, 'utf8')

const p = vi.hoisted(() => {
  const m: Record<string, any> = {
    user:               { findMany: vi.fn(async () => []), update: vi.fn(async () => ({})) },
    memberBlock:        { findMany: vi.fn(async () => []) },
    club:               { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    clubPost:           { create: vi.fn(), findUnique: vi.fn(async () => ({ poll: null })) },
    clubMembership:     { findUnique: vi.fn(async () => ({ status: 'approved', role: 'member' })), findMany: vi.fn(async () => []) },
    notificationPreference: { findMany: vi.fn(async () => []) },
    notification:       { createMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(async () => ({ count: 3 })) },
    broadcast:          { findMany: vi.fn(async () => []), findUnique: vi.fn(), findFirst: vi.fn(async () => null), update: vi.fn(async () => ({})) },
    event:              { findMany: vi.fn(async () => []) },
    passwordResetToken: { deleteMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
  }
  m.$transaction = vi.fn(async (fn: any) => fn(m))
  return m
})
const h = vi.hoisted(() => ({ session: { current: null as Record<string, unknown> | null } }))

vi.mock('@/lib/prisma',    () => ({ prisma: p }))
vi.mock('@/lib/session',   () => ({ getSession: vi.fn(async () => h.session.current) }))
vi.mock('@/lib/notify',    () => ({ createNotification: vi.fn(async () => true) }))
vi.mock('@/lib/audit',     () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/stepUp',    () => ({ requireStepUp: vi.fn(() => null) }))
vi.mock('@/lib/rateLimit', () => ({
  rateLimit:    vi.fn(async () => true),
  claimOnce:    vi.fn(async () => true),
  releaseClaim: vi.fn(async () => {}),
}))
vi.mock('@/lib/email', () => ({
  sendLoginNudgeEmail: vi.fn(async () => {}),
  sendBroadcastEmail:  vi.fn(async () => {}),
  recordEmailFailure:  vi.fn(async () => {}),
}))

import { extractMentions, mentionMatches, notifyMentions } from '@/lib/mentions'
import { MENTION_NAME } from '@/lib/mentionToken'
import { POST as clubPostPOST } from '@/app/api/clubs/[slug]/posts/route'
import { GET as broadcastGET, PATCH as broadcastPATCH } from '@/app/api/admin/notifications/broadcast/route'
import { POST as nudgePOST } from '@/app/api/admin/tools/login-nudge/route'
import { createNotification } from '@/lib/notify'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { sendLoginNudgeEmail } from '@/lib/email'

const admin = { id: 'a1', name: 'Admin', role: 'admin',     cityId: 'c-ist' }
const mod   = { id: 'm1', name: 'Mod',   role: 'moderator', cityId: 'c-ist' }
const jsonReq = (body: unknown) => ({ json: async () => body }) as never
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }
const claim = claimOnce as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  h.session.current = admin
  claim.mockImplementation(async () => true)
  p.memberBlock.findMany.mockResolvedValue([])
  p.broadcast.findFirst.mockResolvedValue(null)
})

// ── 84 — mentions ────────────────────────────────────────────────────────────

describe('84 — mention tokens are Unicode-aware', () => {
  it('reads names that start or continue with non-ASCII letters whole', () => {
    expect(extractMentions('selam @Çağla ve @Ayşe, @İpek @Şule')).toEqual(['Çağla', 'Ayşe', 'İpek', 'Şule'])
  })
  it('composes a decomposed name first, so it equals the stored (NFC) row', () => {
    const nfd = '@Çağla'.normalize('NFD')
    expect(nfd).not.toBe('@Çağla')
    expect(extractMentions(`hi ${nfd}`)).toEqual(['Çağla'])
  })
  it('the shared token pattern (client renderers) matches the whole name', () => {
    const re = new RegExp(`@${MENTION_NAME}`, 'u')
    expect('x @Ayşe y'.match(re)?.[0]).toBe('@Ayşe')
    expect("@Jean-Luc's".match(re)?.[0]).toBe("@Jean-Luc's")
    expect('@Çağla'.normalize('NFD').match(re)?.[0]).toBe('@Çağla'.normalize('NFD'))
  })
})

describe('84 — resolution is by the full token, never a prefix', () => {
  it('"Ayşe" does not match Ayla or Aylin', () => {
    expect(mentionMatches('Ayla Demir', 'Ayşe')).toBe(false)
    expect(mentionMatches('Aylin', 'Ay')).toBe(false)
    expect(mentionMatches('Ayşe Kaya', 'Ayşe')).toBe(true)
  })
  it('compares case-insensitively without locale traps (İ/I/ı)', () => {
    expect(mentionMatches('AYŞE KAYA', 'ayşe')).toBe(true)
    expect(mentionMatches('Işık Tan', 'ışık')).toBe(true)
    expect(mentionMatches('İrem', 'irem')).toBe(true)
  })
  it("an apostrophe suffix resolves to the name it is attached to", () => {
    expect(mentionMatches('Ayşe Kaya', "Ayşe'ye")).toBe(true)
    expect(mentionMatches('Alice', "Ali'nin")).toBe(false)
  })
  it('matches the given name the composer inserts for a leading initial', () => {
    expect(mentionMatches('H. Kübra Çulha', 'Kübra')).toBe(true)
  })

  it('wall: "@Ayşe" notifies Ayşe only, and the query asks for whole words', async () => {
    p.user.findMany.mockResolvedValueOnce([
      { id: 'u-ayse', name: 'Ayşe Kaya' }, { id: 'u-ayla', name: 'Ayla' }, { id: 'u-aylin', name: 'Aylin T.' },
    ])
    const n = await notifyMentions({ content: 'hey @Ayşe', authorId: 'me', authorName: 'Me', cityId: 'c1', link: '/neighborhoods/moda' })
    expect(n).toBe(1)
    expect((createNotification as any).mock.calls.map((c: any[]) => c[0])).toEqual(['u-ayse'])
    const OR = p.user.findMany.mock.calls[0][0].where.OR
    expect(OR).toContainEqual({ name: { equals: 'Ayşe', mode: 'insensitive' } })
    expect(OR).not.toContainEqual({ name: { startsWith: 'Ay', mode: 'insensitive' } })
    expect(OR).not.toContainEqual({ name: { startsWith: 'Ayşe', mode: 'insensitive' } })
  })

  it('wall: "@Çağla" reaches Çağla', async () => {
    p.user.findMany.mockResolvedValueOnce([{ id: 'u-cagla', name: 'Çağla Öz' }])
    const n = await notifyMentions({ content: '@Çağla bak', authorId: 'me', authorName: 'Me', cityId: 'c1', link: '/x' })
    expect(n).toBe(1)
    expect(p.user.findMany.mock.calls[0][0].where.OR).toContainEqual({ name: { startsWith: 'Çağla ', mode: 'insensitive' } })
  })

  it('club wall: "@Ayşe" and "@Çağla" notify exactly those members, blocks respected', async () => {
    p.club.findUnique.mockResolvedValueOnce({ id: 'k1', name: 'Hikers', cityId: 'c-ist' })
    p.clubPost.create.mockResolvedValueOnce({
      id: 'post1', content: '', type: 'post', createdAt: new Date(),
      user: { id: 'a1', name: 'Admin', color: '#000', profilePhoto: null, role: 'admin' },
    })
    p.clubMembership.findMany.mockImplementation(async () => [
      { userId: 'u-ayse',  user: { id: 'u-ayse',  name: 'Ayşe Kaya' } },
      { userId: 'u-ayla',  user: { id: 'u-ayla',  name: 'Ayla Demir' } },
      { userId: 'u-aylin', user: { id: 'u-aylin', name: 'Aylin' } },
      { userId: 'u-cagla', user: { id: 'u-cagla', name: 'Çağla Öz' } },
      { userId: 'u-blk',   user: { id: 'u-blk',   name: 'Çağla B.' } },
    ])
    p.memberBlock.findMany.mockResolvedValueOnce([{ blockerId: 'u-blk', blockedId: 'a1' }])
    const res = await clubPostPOST(jsonReq({ content: 'selam @Ayşe ve @Çağla' }), { params: Promise.resolve({ slug: 'hikers' }) })
    expect(res.status).toBe(200)
    await flush()
    const mentioned = (createNotification as any).mock.calls.filter((c: any[]) => c[1] === 'club_mention').map((c: any[]) => c[0])
    expect(mentioned.sort()).toEqual(['u-ayse', 'u-cagla'])
    p.clubMembership.findMany.mockReset()
  })

  it('client composer and renderers no longer use the ASCII-only \\w token', () => {
    const textarea = read('components/MentionTextarea.tsx')
    expect(textarea).not.toMatch(/@\(\\w\+\)/)
    expect(textarea).toContain(String.raw`/@(\p{L}[\p{L}\p{M}\p{N}_'’-]*)$/u`)
    const rich = read('components/RichText.tsx')
    expect(rich).not.toMatch(/\(@\\w\+\)/)
    expect(rich).toMatch(/\(@\$\{MENTION_NAME\}\)`, 'gu'\)/)
    const wall = read('components/NeighborhoodWall.tsx')
    expect(wall).not.toMatch(/split\(\/\(@\\w\+\)\//)
    expect(wall).not.toMatch(/\/\^@\\w\+\$\//)
    expect(wall).toContain("new RegExp(`(@${MENTION_NAME})`, 'gu')")
    expect(read('app/api/clubs/[slug]/posts/route.ts')).not.toMatch(/startsWith\(word/)
  })
})

// ── 85a — broadcast history scoping ─────────────────────────────────────────

describe('85a — broadcast history for moderators', () => {
  it('a moderator with no city sees nothing, not global-club or network rows', async () => {
    h.session.current = { ...mod, cityId: null }
    p.broadcast.findMany.mockResolvedValueOnce([
      { id: 'b-club-glo', cityId: null, audience: 'club',  clubId: 'k-glo', eventId: null },
      { id: 'b-ev-glo',   cityId: null, audience: 'event', clubId: null,    eventId: 'e-x' },
      { id: 'b-all',      cityId: null, audience: 'all',   clubId: null,    eventId: null },
    ])
    p.club.findMany.mockResolvedValueOnce([{ id: 'k-glo', cityId: null }])
    p.event.findMany.mockResolvedValueOnce([{ id: 'e-x', cityId: null }])
    const rows = await (await broadcastGET()).json()
    expect(rows).toEqual([])
  })
})

// ── 85b — broadcast edit is keyed to its own send ───────────────────────────

describe('85b — editing a broadcast rewrites only that send', () => {
  const sentAt = new Date('2026-09-10T10:00:00Z')

  it('narrows by link and by the window after the previous identical send', async () => {
    p.broadcast.findUnique.mockResolvedValueOnce({ id: 'b2', type: 'reminder', title: 'T', message: 'M', clubId: 'k1', eventId: null, createdAt: sentAt })
    const prevAt = new Date('2026-09-10T09:40:00Z')
    p.broadcast.findFirst.mockResolvedValueOnce({ createdAt: prevAt })
    // Club links are /clubs/<slug> since scan5Batch37; rows sent before carry the id form.
    p.club.findUnique.mockResolvedValueOnce({ slug: 'k-one' })
    const res = await broadcastPATCH(jsonReq({ id: 'b2', title: 'T2', message: 'M2' }))
    expect(res.status).toBe(200)
    expect(p.broadcast.findFirst.mock.calls[0][0].where).toMatchObject({ id: { not: 'b2' }, title: 'T', message: 'M', clubId: 'k1', eventId: null })
    expect(p.notification.updateMany.mock.calls[0][0]).toEqual({
      where: { type: 'announcement', title: 'T', body: 'M', link: { in: ['/clubs/k-one', '/clubs/k1'] }, createdAt: { gt: prevAt, lte: sentAt } },
      data:  { title: 'T2', body: 'M2' },
    })
  })

  it('without an earlier identical send, looks back at most an hour; city/all sends match link null', async () => {
    p.broadcast.findUnique.mockResolvedValueOnce({ id: 'b3', type: 'alert', title: 'T', message: 'M', clubId: null, eventId: null, createdAt: sentAt })
    p.broadcast.findFirst.mockResolvedValueOnce({ createdAt: new Date('2026-09-01T00:00:00Z') })
    await broadcastPATCH(jsonReq({ id: 'b3', title: 'T2', message: 'M2' }))
    expect(p.notification.updateMany.mock.calls[0][0].where).toEqual({
      type: 'system_alert', title: 'T', body: 'M', link: null,
      createdAt: { gt: new Date(sentAt.getTime() - 60 * 60_000), lte: sentAt },
    })
  })

  it('an event send matches its event link', async () => {
    p.broadcast.findUnique.mockResolvedValueOnce({ id: 'b4', type: 'announcement', title: 'T', message: 'M', clubId: 'k1', eventId: 'e1', createdAt: sentAt })
    await broadcastPATCH(jsonReq({ id: 'b4', title: 'T2', message: 'M2' }))
    expect(p.notification.updateMany.mock.calls[0][0].where.link).toBe('/events/e1')
  })

  it('moderators still cannot edit', async () => {
    h.session.current = mod
    expect((await broadcastPATCH(jsonReq({ id: 'b2', title: 'x', message: 'y' }))).status).toBe(403)
    expect(p.notification.updateMany).not.toHaveBeenCalled()
  })
})

// ── 85c — login nudge tool claims ────────────────────────────────────────────

describe('85c — the login-nudge tool cannot double-send', () => {
  const members = [
    { id: 'u1', name: 'Mia', email: 'mia@x', nudgesSent: 0 },
    { id: 'u2', name: 'Ali', email: 'ali@x', nudgesSent: 1 },
  ]

  it('a second run while one is in flight answers 409 and sends nothing', async () => {
    claim.mockImplementation(async (key: string) => !key.startsWith('admin-login-nudge-run:'))
    const res = await nudgePOST()
    expect(res.status).toBe(409)
    expect(p.user.findMany).not.toHaveBeenCalled()
    expect(sendLoginNudgeEmail).not.toHaveBeenCalled()
    expect(releaseClaim).not.toHaveBeenCalled()
  })

  it('run claim is per audience and handed back when the run ends', async () => {
    p.user.findMany.mockResolvedValueOnce([])
    await nudgePOST()
    expect(claim).toHaveBeenCalledWith('admin-login-nudge-run:all', 10 * 60_000)
    expect(releaseClaim).toHaveBeenCalledWith('admin-login-nudge-run:all')

    vi.clearAllMocks(); claim.mockImplementation(async () => true)
    h.session.current = mod
    p.user.findMany.mockRejectedValueOnce(new Error('db down'))
    expect((await nudgePOST()).status).toBe(500)
    expect(claim).toHaveBeenCalledWith('admin-login-nudge-run:c-ist', 10 * 60_000)
    expect(releaseClaim).toHaveBeenCalledWith('admin-login-nudge-run:c-ist')
  })

  it('a member already claimed by an overlapping run is skipped', async () => {
    p.user.findMany.mockResolvedValueOnce(members)
    claim.mockImplementation(async (key: string) => key !== 'login-nudge:u1:1')
    const data = await (await nudgePOST()).json()
    expect(data).toMatchObject({ sent: 1, failed: 0 })
    expect((sendLoginNudgeEmail as any).mock.calls.map((c: any[]) => c[0])).toEqual(['ali@x'])
    expect(claim).toHaveBeenCalledWith('login-nudge:u2:2', 7 * 24 * 60 * 60 * 1000)
  })

  it('a send that fails before the email went out releases the member claim', async () => {
    p.user.findMany.mockResolvedValueOnce([members[0]])
    ;(sendLoginNudgeEmail as any).mockRejectedValueOnce(new Error('resend 500'))
    const data = await (await nudgePOST()).json()
    expect(data).toMatchObject({ sent: 0, failed: 1 })
    expect(releaseClaim).toHaveBeenCalledWith('login-nudge:u1:1')
  })

  it('a stamp failure after the email went out keeps the member claim', async () => {
    p.user.findMany.mockResolvedValueOnce([members[0]])
    p.user.update.mockRejectedValueOnce(new Error('db blip'))
    await nudgePOST()
    expect(sendLoginNudgeEmail).toHaveBeenCalledTimes(1)
    expect(releaseClaim).not.toHaveBeenCalledWith('login-nudge:u1:1')
  })
})
