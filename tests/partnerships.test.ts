import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { validatePartnershipInput, STAGES } from '@/lib/partnerships'

const read = (f: string) => readFileSync(f, 'utf8')

describe('pipeline stages', () => {
  it('are exactly the ten agreed stages, in order', () => {
    expect(STAGES.map(s => s.label)).toEqual([
      'Research', 'Email Ready', 'Email Sent', 'Waiting Reply', 'Follow-up Needed', 'Replied',
      'Meeting Planned', 'Collaboration Agreed', 'Active Partner', 'Not Relevant / Closed',
    ])
  })
})

describe('validatePartnershipInput', () => {
  it('requires an organizer on create but not on a partial update', () => {
    expect(validatePartnershipInput({}, false).ok).toBe(false)
    expect(validatePartnershipInput({ stage: 'replied' }, true)).toEqual({ ok: true, data: { stage: 'replied' } })
    expect(validatePartnershipInput({ organizer: '  ' }, true).ok).toBe(false)
  })
  it('refuses unknown stages, types, commission types and payment statuses', () => {
    for (const bad of [{ stage: 'won' }, { type: 'x' }, { commissionType: 'flat' }, { paymentStatus: 'refunded' }]) {
      expect(validatePartnershipInput({ organizer: 'A', ...bad }, false).ok).toBe(false)
    }
  })
  it('keeps fee and commission as separate agreed figures', () => {
    const r = validatePartnershipInput({ organizer: 'A', feeAmount: 500, feeCurrency: 'EUR', commissionType: 'percentage', commissionRate: 10, commissionBasis: 'net ticket price' }, false)
    expect(r).toMatchObject({ ok: true, data: { feeAmount: 500, feeCurrency: 'EUR', commissionType: 'percentage', commissionRate: 10 } })
  })
  it('rejects negative money, a percentage over 100, and unknown currencies', () => {
    expect(validatePartnershipInput({ organizer: 'A', feeAmount: -1 }, false).ok).toBe(false)
    expect(validatePartnershipInput({ organizer: 'A', commissionType: 'percentage', commissionRate: 101 }, false).ok).toBe(false)
    expect(validatePartnershipInput({ organizer: 'A', feeCurrency: 'ZZZ' }, false).ok).toBe(false)
  })
  it('checks dates, date order, email and https website', () => {
    expect(validatePartnershipInput({ organizer: 'A', followUpDate: '12/10/2026' }, false).ok).toBe(false)
    expect(validatePartnershipInput({ organizer: 'A', startDate: '2026-11-05', endDate: '2026-11-01' }, false).ok).toBe(false)
    expect(validatePartnershipInput({ organizer: 'A', contactEmail: 'nope' }, false).ok).toBe(false)
    expect(validatePartnershipInput({ organizer: 'A', website: 'http://x.com' }, false).ok).toBe(false)
    expect(validatePartnershipInput({ organizer: 'A', website: 'javascript:alert(1)' }, false).ok).toBe(false)
  })
  it('clears optional fields with null or empty and rejects non-objects', () => {
    expect(validatePartnershipInput({ followUpDate: '', feeAmount: null }, true)).toEqual({ ok: true, data: { followUpDate: null, feeAmount: null } })
    expect(validatePartnershipInput('x', false).ok).toBe(false)
    expect(validatePartnershipInput([], false).ok).toBe(false)
  })
})

describe('admin-only access and no outreach', () => {
  it('every partnership route checks isAdmin and returns 403 otherwise', () => {
    for (const f of ['app/api/admin/partnerships/route.ts', 'app/api/admin/partnerships/export/route.ts']) {
      const src = read(f)
      expect(src).toMatch(/isAdmin\(/)
      expect(src).toMatch(/Forbidden/)
      expect(src).toMatch(/status: 403/)
    }
    const route = read('app/api/admin/partnerships/route.ts')
    expect((route.match(/requireAdmin\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })
  it('moderators and members are not given the nav entry', () => {
    expect(read('lib/adminNav.ts')).toMatch(/label: 'Partnerships', href: '\/admin\/partnerships', exact: false, roles: \['admin'\]/)
  })
  it('nothing in the partnership code can send email or messages', () => {
    for (const f of ['app/api/admin/partnerships/route.ts', 'app/api/admin/partnerships/export/route.ts', 'lib/partnerships.ts', 'app/admin/partnerships/page.tsx']) {
      expect(read(f)).not.toMatch(/resend|sendEmail|lib\/email|lib\/notify|whatsapp|mailto:/i)
    }
  })
  it('no public page or API reads partnership records', () => {
    const { execSync } = require('child_process') as typeof import('child_process')
    const files = execSync(`grep -rlE "prisma\\.partnership\\b" app lib components`, { encoding: 'utf8' }).split('\n').filter(Boolean).sort()
    // Admin-only routes only: the partnership CRUD/export and the admin campaign-report routes.
    expect(files).toEqual([
      'app/api/admin/partnership-reports/export/route.ts',
      'app/api/admin/partnership-reports/route.ts',
      'app/api/admin/partnerships/export/route.ts',
      'app/api/admin/partnerships/route.ts',
    ])
  })
  it('the admin actions are audited', () => {
    const src = read('app/api/admin/partnerships/route.ts') + read('app/api/admin/partnerships/export/route.ts')
    for (const a of ['partnership.create', 'partnership.update', 'partnership.export']) expect(src).toContain(a)
  })
  it('the CSV export neutralises spreadsheet formulas and is no-store', () => {
    const src = read('app/api/admin/partnerships/export/route.ts')
    expect(src).toMatch(/\[=\+\\-@/)
    expect(src).toMatch(/no-store/)
  })
})
