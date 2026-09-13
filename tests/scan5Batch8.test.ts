import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 5, items 32–35.
const read = (p: string) => readFileSync(p, 'utf8')

const p = vi.hoisted(() => {
  const m: Record<string, any> = {
    partner: { findUnique: vi.fn(), delete: vi.fn(async () => ({})) },
    user:    { updateMany: vi.fn(async () => ({ count: 2 })) },
  }
  m.$transaction = vi.fn(async (ops: any[]) => Promise.all(ops))
  return m
})
const h = vi.hoisted(() => ({ stepUp: null as unknown, session: { id: 'adm', name: 'Admin', role: 'admin' } as Record<string, unknown> | null }))
vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => h.session) }))
vi.mock('@/lib/access', () => ({ isAdmin: (s: { role: string }) => s.role === 'admin', canManagePartners: vi.fn(() => true), failClosedCityId: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/stepUp', () => ({ requireStepUp: vi.fn(() => h.stepUp) }))
vi.mock('@/lib/city', () => ({ resolveTargetCityId: vi.fn() }))

import { DELETE as partnerDELETE } from '@/app/api/admin/partners/route'

beforeEach(() => { vi.clearAllMocks(); h.stepUp = null; h.session = { id: 'adm', name: 'Admin', role: 'admin' } })

describe('32. saving community settings sends only community fields', () => {
  it('the load keeps only the form\'s own keys, so Save can\'t echo other settings back', () => {
    const src = read('app/admin/settings/page.tsx')
    expect(src).toContain("for (const k of Object.keys(prev) as (keyof typeof prev)[]) {")
    expect(src).not.toContain('setCommunity(prev => ({ ...prev, ...rest }))')
  })
})

describe('33. deleting a partner moves its accounts back to member', () => {
  const del = () => partnerDELETE(new Request('http://x', { method: 'DELETE', body: JSON.stringify({ id: 'pt1' }) }) as never)
  beforeEach(() => {
    p.partner.findUnique.mockResolvedValue({ id: 'pt1', name: 'Café', category: 'cafe', discount: '10%', isActive: true, createdAt: new Date(), _count: { users: 2 } })
  })
  it('demotes, unlinks, ends sessions and deletes in one transaction', async () => {
    expect((await del()).status).toBe(200)
    expect(p.$transaction).toHaveBeenCalledTimes(1)
    expect(p.user.updateMany.mock.calls[0][0]).toEqual({
      where: { partnerId: 'pt1', role: 'partner' },
      data:  { role: 'member', partnerId: null, tokenVersion: { increment: 1 } },
    })
    expect(p.user.updateMany.mock.calls[1][0]).toEqual({ where: { partnerId: 'pt1' }, data: { partnerId: null } })
    expect(p.partner.delete).toHaveBeenCalledWith({ where: { id: 'pt1' } })
  })
  it('stops at step-up when it is required', async () => {
    h.stepUp = new Response(JSON.stringify({ error: 'Step-up required' }), { status: 401 })
    expect((await del()).status).toBe(401)
    expect(p.partner.delete).not.toHaveBeenCalled()
  })
})

describe('34. payment through Smileys stays a staff decision', () => {
  it('hosts can\'t change payTo or paymentContact on edit, and a host\'s new event is paid at the venue', () => {
    const put = read('app/api/admin/events/[id]/route.ts')
    expect(put).toMatch(/delete rest\.featured[\s\S]{0,700}delete rest\.payTo\s*\n\s*delete rest\.paymentContact/)
    const post = read('app/api/admin/events/route.ts')
    expect(post).toContain("payTo:                needsReview ? 'venue' : (payTo || 'venue'),")
    expect(post).toContain('paymentContact:       needsReview ? null : contact,')
  })
})

describe('35. a dropped connection never leaves a false check-in', () => {
  it.each([
    ['app/host/checkin/page.tsx',  /try \{\s*const res = await fetch\(`\/app\/api\/events\/\$\{eventId\}\/checkin`[\s\S]*?\} catch \{\s*failure = 'No connection/],
    ['app/admin/checkin/page.tsx', /try \{\s*const res = await fetch\(`\/app\/api\/events\/\$\{selectedId\}\/checkin`[\s\S]*?\} catch \{\s*\/\/ Roll back the optimistic flip/],
    ['lib/checkin.ts',             /try \{\s*const res = await fetch\(`\/app\/api\/events\/\$\{eventId\}\/checkin`[\s\S]*?\} catch \{\s*setAttendees\(prev => prev\.map\(a => a\.userId === userId \? \{ \.\.\.a, checkedIn: false \}/],
  ])('%s rolls the optimistic check-in back when the request fails', (file, pattern) => {
    expect(read(file)).toMatch(pattern)
  })
})
