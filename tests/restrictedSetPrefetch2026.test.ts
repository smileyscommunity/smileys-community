import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-09-23. The dashboard fetched the viewer's accepted connections for its
// own LISTABLE filter, then called restrictedSetFor, which ran the identical
// query again on the same request. Rare before; after the "Who's going" rework
// it fires on most non-empty dashboards. restrictedSetFor now takes those ids
// as an optional third argument.
//
// The optimisation is only safe while the caller's set means the same thing as
// the query it replaces. A wrong or partial set silently exposes a
// connections-only member, or hides one who consented — so the equivalence is
// pinned here, not left to reviewers noticing.

vi.mock('@/lib/prisma', () => ({ prisma: { memberConnection: { findMany: vi.fn() } } }))
vi.mock('@/lib/access', () => ({
  isAdminOrModerator: vi.fn(() => false),
  isClubHost: vi.fn(async () => false),
}))

import { restrictedSetFor, connectionIdsFor } from '@/lib/memberPrivacy'
import { prisma } from '@/lib/prisma'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const session = { id: 'me', role: 'member' } as any
const m = (id: string, vis: string) => ({ id, profileVisibility: vis })

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.memberConnection.findMany as any).mockResolvedValue([])
})

describe('pre-fetched connections', () => {
  it('skips the query entirely when the caller supplies them', async () => {
    const r = await restrictedSetFor(session, [m('a', 'connections')], ['a'])
    expect(prisma.memberConnection.findMany).not.toHaveBeenCalled()
    expect(r.size).toBe(0)   // 'a' is a connection, so not restricted
  })

  it('still queries when they are omitted', async () => {
    await restrictedSetFor(session, [m('a', 'connections')])
    expect(prisma.memberConnection.findMany).toHaveBeenCalledTimes(1)
  })

  it('gives the same answer either way', async () => {
    ;(prisma.memberConnection.findMany as any).mockResolvedValue([
      { requesterId: 'me', receiverId: 'friend' },
      { requesterId: 'other', receiverId: 'me' },
    ])
    const members = [m('friend', 'connections'), m('other', 'connections'), m('stranger', 'connections')]
    const queried  = await restrictedSetFor(session, members)
    const prefetch = await restrictedSetFor(session, members, ['friend', 'other'])
    expect([...queried].sort()).toEqual(['stranger'])
    expect([...prefetch].sort()).toEqual([...queried].sort())
  })

  it('an EMPTY supplied set restricts every private member — it is not "unknown"', async () => {
    // The dangerous misreading: passing [] must mean "no connections", not
    // "fall back to the query". Otherwise a caller with genuinely zero
    // connections would silently get everyone unrestricted.
    const r = await restrictedSetFor(session, [m('a', 'connections')], [])
    expect(prisma.memberConnection.findMany).not.toHaveBeenCalled()
    expect([...r]).toEqual(['a'])
  })

  it('accepts a Set as readily as an array', async () => {
    const r = await restrictedSetFor(session, [m('a', 'connections')], new Set(['a']))
    expect(r.size).toBe(0)
  })

  it('still short-circuits before any of this when nobody is private', async () => {
    const r = await restrictedSetFor(session, [m('a', 'everyone')], [])
    expect(r.size).toBe(0)
  })
})

describe('connectionIdsFor', () => {
  it('returns the OTHER party, whichever side the viewer sat on', async () => {
    ;(prisma.memberConnection.findMany as any).mockResolvedValue([
      { requesterId: 'me', receiverId: 'a' },
      { requesterId: 'b',  receiverId: 'me' },
    ])
    expect([...(await connectionIdsFor('me'))].sort()).toEqual(['a', 'b'])
  })

  it('asks only for accepted rows on either side', async () => {
    await connectionIdsFor('me')
    const { where } = (prisma.memberConnection.findMany as any).mock.calls[0][0]
    expect(where.status).toBe('accepted')
    expect(where.OR).toEqual([{ requesterId: 'me' }, { receiverId: 'me' }])
  })
})

describe('the dashboard set it passes means the same thing', () => {
  const dash = src('app/(member)/dashboard/page.tsx')

  it('fetches accepted connections on both sides, as the contract requires', () => {
    expect(dash).toContain("where:  { status: 'accepted', OR: [{ requesterId: session.id }, { receiverId: session.id }] },")
  })

  it('maps rows to the other party, the same way connectionIdsFor does', () => {
    expect(dash).toContain('connectionRows.map(c => c.requesterId === session.id ? c.receiverId : c.requesterId)')
  })

  it('and actually passes them, rather than paying for the read twice', () => {
    expect(dash).toMatch(/\.\.\.recentPulses\.map\(p => p\.user\),\s*\], connectedIds\)/)
  })
})
