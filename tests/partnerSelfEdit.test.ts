import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { partner: {
  update: vi.fn(async ({ data }: any) => ({ id: 'p1', ...data })),
  // The stored row: an admin-set external logo, no cover.
  findUnique: vi.fn(async () => ({ logo: 'https://cdn.example/logo.png', coverImage: null })),
} } }))

import { PATCH } from '@/app/api/partner/route'
import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

// Everything a partner account saves here is rendered to every member on
// /perks — `website` as an <a href>, the images as <img src>. The route copied
// the body verbatim, so a javascript: link or a non-string 500 got through.

const req = (body: any) => ({ json: async () => body }) as any
const p = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as any).mockResolvedValue({ id: 'u1', role: 'partner', partnerId: 'p1' })
})

describe('PATCH /api/partner', () => {
  it('rejects a javascript: website', async () => {
    const res = await PATCH(req({ website: 'javascript:alert(1)' }))
    expect(res.status).toBe(400)
    expect(p.partner.update).not.toHaveBeenCalled()
  })
  it('accepts only images uploaded through Smileys (an external URL is a tracking pixel on /perks)', async () => {
    expect((await PATCH(req({ logo: 'data:text/html,x' }))).status).toBe(400)
    expect((await PATCH(req({ logo: 'https://other.example/new.png' }))).status).toBe(400)
    expect((await PATCH(req({ coverImage: '/app/api/files/general/abc.jpg' }))).status).toBe(200)
  })
  it('does not re-validate an image the settings page merely echoed back unchanged', async () => {
    // The page PATCHes the whole record it loaded; an admin-set external
    // logo came back on every save and every save failed.
    const res = await PATCH(req({ logo: 'https://cdn.example/logo.png', discount: '15%' }))
    expect(res.status).toBe(200)
    expect(p.partner.update.mock.calls[0][0].data).toEqual({ discount: '15%' })
  })
  it('rejects non-string fields instead of throwing', async () => {
    const res = await PATCH(req({ name: { $set: 'x' } }))
    expect(res.status).toBe(400)
  })
  it('normalises the instagram handle and trims text', async () => {
    const res = await PATCH(req({ instagram: 'https://instagram.com/@smileys.ist', discount: '  10% off  ' }))
    expect(res.status).toBe(200)
    expect(p.partner.update.mock.calls[0][0].data).toEqual({ instagram: 'smileys.ist', discount: '10% off' })
  })
  it('does not touch fields the body did not send', async () => {
    await PATCH(req({ discount: '5%' }))
    expect(Object.keys(p.partner.update.mock.calls[0][0].data)).toEqual(['discount'])
  })
})
