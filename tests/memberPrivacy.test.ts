import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB + role helpers so we test only restrictedSetFor's own logic.
vi.mock('@/lib/prisma', () => ({ prisma: { memberConnection: { findMany: vi.fn() } } }))
vi.mock('@/lib/access', () => ({
  isAdminOrModerator: vi.fn(() => false),
  isClubHost: vi.fn(async () => false),
}))

import { restrictedSetFor } from '@/lib/memberPrivacy'
import { prisma } from '@/lib/prisma'
import { isAdminOrModerator, isClubHost } from '@/lib/access'

const session = { id: 'me', role: 'member' } as any
const m = (id: string, vis: string) => ({ id, profileVisibility: vis })

beforeEach(() => {
  vi.clearAllMocks()
  ;(isAdminOrModerator as any).mockReturnValue(false)
  ;(isClubHost as any).mockResolvedValue(false)
  ;(prisma.memberConnection.findMany as any).mockResolvedValue([])
})

describe('restrictedSetFor (connections-only privacy gating)', () => {
  it('returns empty (and skips the DB) when no member is private', async () => {
    const r = await restrictedSetFor(session, [m('a', 'everyone'), m('b', 'everyone')])
    expect(r.size).toBe(0)
    expect(prisma.memberConnection.findMany).not.toHaveBeenCalled()
  })

  it('never restricts your own card', async () => {
    const r = await restrictedSetFor(session, [m('me', 'connections')])
    expect(r.size).toBe(0)
  })

  it('admins/moderators see everyone — no restriction, no DB hit', async () => {
    ;(isAdminOrModerator as any).mockReturnValue(true)
    const r = await restrictedSetFor(session, [m('a', 'connections')])
    expect(r.size).toBe(0)
    expect(prisma.memberConnection.findMany).not.toHaveBeenCalled()
  })

  it('club hosts see everyone', async () => {
    ;(isClubHost as any).mockResolvedValue(true)
    const r = await restrictedSetFor(session, [m('a', 'connections')])
    expect(r.size).toBe(0)
  })

  it('restricts only private members the viewer is NOT connected to', async () => {
    ;(prisma.memberConnection.findMany as any).mockResolvedValue([
      { requesterId: 'me', receiverId: 'friendA' },   // accepted, viewer is requester
      { requesterId: 'friendB', receiverId: 'me' },    // accepted, viewer is receiver
    ])
    const r = await restrictedSetFor(session, [
      m('friendA', 'connections'),  // connected → visible
      m('friendB', 'connections'),  // connected (other direction) → visible
      m('stranger', 'connections'), // private, not connected → RESTRICTED
      m('pub', 'everyone'),         // public → visible
    ])
    expect([...r]).toEqual(['stranger'])
  })
})
