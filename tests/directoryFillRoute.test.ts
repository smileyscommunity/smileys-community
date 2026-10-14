import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Admin > Directory > Needs details: the route starts a paid web-research
// script, so the guards are the point — admin only, a validated id, approved
// rows only, one run at a time, and no shell in the command.
const p = vi.hoisted(() => ({ business: { findMany: vi.fn(), findUnique: vi.fn() } }))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
const claims  = vi.hoisted(() => ({ free: true, released: [] as string[] }))
const proc    = vi.hoisted(() => ({ calls: [] as unknown[][], child: null as unknown }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/rateLimit', () => ({
  claimOnce:    vi.fn(async () => claims.free),
  releaseClaim: vi.fn(async (k: string) => { claims.released.push(k) }),
}))
vi.mock('child_process', () => ({
  spawn: vi.fn((...a: unknown[]) => { proc.calls.push(a); return proc.child }),
}))

import { GET, POST } from '@/app/api/admin/directory/fill/route'

const admin = { id: 'a1', name: 'Adm', email: 'a@x', role: 'admin', cityId: 'c1' }
const ID = 'cmujrd0fe002qmi6fjriw0sta'
const post = (body: unknown) => new Request('http://x/app/api/admin/directory/fill', { method: 'POST', body: JSON.stringify(body) }) as never
const get  = (q = '') => new Request(`http://x/app/api/admin/directory/fill${q}`) as never

beforeEach(() => {
  vi.clearAllMocks()
  session.current = admin
  claims.free = true; claims.released = []
  proc.calls = []
  const child = new EventEmitter() as EventEmitter & { unref: () => void }
  child.unref = () => {}
  proc.child = child
  p.business.findUnique.mockResolvedValue({ id: ID, isApproved: true })
})

describe('POST', () => {
  it.each(['moderator', 'member'])('refuses a %s', async (role) => {
    session.current = { ...admin, role }
    expect((await POST(post({ id: ID }))).status).toBe(403)
    expect(proc.calls).toHaveLength(0)
  })

  it('rejects an id that is not a cuid, so nothing odd reaches the command line', async () => {
    for (const id of ['', 'x; rm -rf /', '--write', '../etc', ID + ' --overwrite']) {
      expect((await POST(post({ id }))).status).toBe(400)
    }
    expect(proc.calls).toHaveLength(0)
  })

  it('only fills approved businesses', async () => {
    p.business.findUnique.mockResolvedValue({ id: ID, isApproved: false })
    expect((await POST(post({ id: ID }))).status).toBe(400)
    p.business.findUnique.mockResolvedValue(null)
    expect((await POST(post({ id: ID }))).status).toBe(404)
    expect(proc.calls).toHaveLength(0)
  })

  it('one run at a time', async () => {
    claims.free = false
    expect((await POST(post({ id: ID }))).status).toBe(409)
    expect(proc.calls).toHaveLength(0)
  })

  it('previews by default: no --write', async () => {
    const body = await (await POST(post({ id: ID }))).json()
    expect(body.job).toMatch(/^[a-f0-9]{16}$/)
    const [, args, opts] = proc.calls[0] as [string, string[], Record<string, unknown>]
    expect(args).toContain('scripts/fill-directory-listings.ts')
    expect(args).toEqual(expect.arrayContaining(['--id', ID]))
    expect(args).not.toContain('--write')
    expect(opts.shell).toBeUndefined()
  })

  it('writes only when asked to, and releases the lock when the script exits', async () => {
    await POST(post({ id: ID, write: true }))
    expect((proc.calls[0] as [string, string[]])[1]).toContain('--write')
    expect(claims.released).toEqual([])
    ;(proc.child as EventEmitter).emit('exit', 0)
    expect(claims.released).toEqual(['directory-fill'])
  })
})

describe('GET', () => {
  it('refuses a moderator', async () => {
    session.current = { ...admin, role: 'moderator' }
    expect((await GET(get())).status).toBe(403)
  })

  it('rejects a job id that could walk out of the job folder', async () => {
    expect((await GET(get('?job=../../etc/passwd'))).status).toBe(400)
  })

  it('lists approved businesses with what each is missing, skipping complete ones', async () => {
    const full = { id: 'f', name: 'Full', category: 'cafe', neighborhood: null, city: { name: 'Istanbul' }, reviewedAt: new Date(), createdAt: new Date(),
      description: 'A long, real description of a place that has plenty of detail about what it is and offers members.', website: 'https://x.com', phone: '1', hours: {}, coverImage: '/c.jpg' }
    const bare = { ...full, id: 'b', name: 'Bare', description: 'Community venue — added from a Smileys event', website: null, phone: null, hours: null, coverImage: null }
    p.business.findMany.mockResolvedValue([full, bare])
    const { items } = await (await GET(get())).json()
    expect(items.map((i: { id: string }) => i.id)).toEqual(['b'])
    expect(items[0].missing).toEqual(['cover', 'description', 'website', 'hours', 'phone'])
    expect(p.business.findMany.mock.calls[0][0].where).toMatchObject({ isApproved: true, isActive: true, closedAt: null })
  })
})
