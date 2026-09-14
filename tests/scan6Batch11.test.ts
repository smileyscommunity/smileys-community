import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Scan 6, batch 11: the partner edit panels echoed the whole row back, and the
// 2026-09-14 field validation then refused a legacy logo / handle that was
// merely passing through — so a partner with an old http:// logo could not have
// its discount edited at all. Only changed values are validated and written now.
const read = (f: string) => readFileSync(f, 'utf8')

const p = vi.hoisted(() => ({
  partner: { findUnique: vi.fn(), update: vi.fn() },
  user:    { findUnique: vi.fn() },
}))
const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock('@/lib/prisma', () => ({ prisma: p }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => session.current) }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }))

import { PATCH as adminPartnerPATCH } from '@/app/api/admin/partners/[id]/route'
import { PATCH as partnerPATCH } from '@/app/api/partner/route'
import { normalizeInstagramHandle } from '@/lib/directory-constants'

const admin = { id: 'a1', name: 'Adm', email: 'a@x', role: 'admin', cityId: 'c1' }
const params = { params: Promise.resolve({ id: 'p1' }) }
const jsonReq = (body: unknown) => ({ json: async () => body }) as never

// Values stored before the current rules, none of which would pass them today.
const legacyRow = {
  id: 'p1', cityId: 'c1', name: 'Café Moda', category: 'Cafe', discount: '10% off',
  address: 'Moda Cd. 1', neighborhood: 'Kadıköy',
  website: 'http://cafe.example', instagram: 'cafe moda',
  logo: 'http://cdn.example/logo.png', coverImage: 'uploads/cover.jpg', isActive: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  session.current = admin
  p.partner.findUnique.mockResolvedValue(legacyRow)
  p.partner.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...legacyRow, ...data }))
})

describe('admin partner PATCH validates only what changed', () => {
  const patch = (body: unknown) => adminPartnerPATCH(jsonReq(body), params)

  it('the whole legacy row echoed back with a new discount saves, writing only the discount', async () => {
    const { id: _id, cityId: _c, ...form } = legacyRow
    const res = await patch({ ...form, discount: '20% off' })
    expect(res.status).toBe(200)
    expect(p.partner.update).toHaveBeenCalledTimes(1)
    expect(p.partner.update.mock.calls[0][0].data).toEqual({ discount: '20% off' })
  })

  it('a changed logo still gets full validation', async () => {
    const res = await patch({ logo: 'http://cdn.example/new.png' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/logo must be an https:\/\/ image URL/)
    expect((await patch({ logo: 'javascript:alert(1)' })).status).toBe(400)
    expect((await patch({ instagram: 'https://evil.com/cafe' })).status).toBe(400)
    expect(p.partner.update).not.toHaveBeenCalled()
  })

  it('a changed logo that passes is written', async () => {
    expect((await patch({ logo: '/app/api/files/general/new.jpg' })).status).toBe(200)
    expect(p.partner.update.mock.calls[0][0].data).toEqual({ logo: '/app/api/files/general/new.jpg' })
  })

  it('whitespace differences and "@handle" over the stored handle are not edits', async () => {
    p.partner.findUnique.mockResolvedValue({ ...legacyRow, instagram: 'cafemoda' })
    const res = await patch({ name: '  Café Moda ', instagram: '@cafemoda', isActive: true })
    expect(res.status).toBe(200)
    expect(p.partner.update).not.toHaveBeenCalled()
  })

  it('clearing a legacy value is a change and is written', async () => {
    expect((await patch({ logo: '', website: '' })).status).toBe(200)
    expect(p.partner.update.mock.calls[0][0].data).toEqual({ logo: null, website: null })
  })
})

describe('partner self-service PATCH behaves the same', () => {
  beforeEach(() => {
    session.current = { id: 'u1', name: 'Pat', email: 'pat@x', role: 'partner', partnerId: 'p1' }
    p.user.findUnique.mockResolvedValue({ role: 'partner', partnerId: 'p1' })
  })

  it('a legacy website and handle echoed back do not block a discount edit', async () => {
    const res = await partnerPATCH(jsonReq({
      name: legacyRow.name, discount: '15% off', website: legacyRow.website,
      instagram: legacyRow.instagram, logo: legacyRow.logo, coverImage: legacyRow.coverImage,
    }))
    expect(res.status).toBe(200)
    expect(p.partner.update.mock.calls[0][0].data).toEqual({ discount: '15% off' })
  })

  it('a changed website is still validated', async () => {
    expect((await partnerPATCH(jsonReq({ website: 'http://new.example' }))).status).toBe(400)
    expect(p.partner.update).not.toHaveBeenCalled()
  })
})

describe('instagram handles normalise from the forms people paste', () => {
  it.each([
    'foo', '@foo', ' @foo ', 'foo/', 'instagram.com/foo', 'www.instagram.com/foo',
    'https://www.instagram.com/foo/', 'http://instagram.com/@foo', 'https://instagram.com/foo?igsh=abc123',
    'm.instagram.com/foo', 'instagr.am/foo', 'HTTPS://Instagram.com/foo#top',
  ])('%s → foo', (raw) => {
    expect(normalizeInstagramHandle(raw)).toBe('foo')
  })

  it.each([
    'https://evil.com/foo', 'evil.com/foo', 'https://notinstagram.com/foo', 'instagram.com.evil.com/foo',
    'javascript:alert(1)', 'instagram.com', 'instagram.com/p/Cx12ab', 'https://www.instagram.com/reel/xyz/',
    'foo bar', '@', '',
  ])('%s is refused', (raw) => {
    expect(normalizeInstagramHandle(raw)).toBeNull()
  })
})

describe('the edit forms send only edited fields', () => {
  it('admin partners page diffs the form against the loaded partner', () => {
    const src = read('app/admin/partners/page.tsx')
    expect(src).toMatch(/if \(\(form\[k\] \?\? ''\) !== \(original\[k\] \?\? ''\)\) changed\[key\] = form\[k\]/)
    expect(src).toMatch(/body: JSON\.stringify\(changed\)/)
    expect(src).not.toMatch(/body: JSON\.stringify\(data\)/)
  })
  it('partner settings page diffs against the last-saved record', () => {
    const src = read('app/partner/settings/page.tsx')
    expect(src).toMatch(/if \(\(formData\[key\] \|\| null\) !== \(saved\[key\] \|\| null\)\) body\[key\] = formData\[key\] \|\| null/)
    expect(src).toMatch(/body: JSON\.stringify\(body\)/)
  })
})
