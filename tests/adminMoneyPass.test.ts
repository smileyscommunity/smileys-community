import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { roundMoney } from '@/lib/money'

// Admin review, money items (2026-09-27).
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('totals are in one currency at a time', () => {
  it('analytics reports revenue in the scope\'s main currency and names the rest', () => {
    const api = read('app/api/admin/analytics/route.ts')
    expect(api).toContain("const paid     = allPayments.filter(p => p.status === 'paid'     && inRevCur(p))")
    expect(api).toContain('currency: revenueCurrency,')
    expect(api).toContain('otherCurrencies: revenueOtherCurrencies,')
  })
  it('revenue by event splits by the payments\' currency', () => {
    expect(read('app/api/admin/payments/route.ts')).toContain("by:    ['eventId', 'status', 'currency'],")
  })
  it('sponsor deals carry their own currency and won totals are per currency', () => {
    const api = read('app/api/admin/sponsors/route.ts')
    expect(api).toContain('!KNOWN_CURRENCIES.includes(currency)')
    expect(api).toContain("by:     ['currency'],")
    expect(read('app/admin/sponsors/page.tsx')).toContain('KNOWN_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)')
  })
})

describe('payment status changes apply once', () => {
  it('the payments PATCH is a compare-and-set', () => {
    const api = read('app/api/admin/payments/route.ts')
    expect(api).toContain('where: { id, status: current.status },')
    expect(api).toContain("This payment changed in the meantime")
  })
  it('the checklist goes through lib/paymentStatus and cannot double-create', () => {
    const src = read('app/api/admin/events/[id]/participants/route.ts')
    expect(src).toContain('await changePaymentStatus({')
    expect(src).toContain('claimOnce(`checklist-markpaid:${userId}:${eventId}`')
    expect(read('lib/paymentStatus.ts')).toContain('where: { id: paymentId, status: from },')
  })
})

describe('roundMoney', () => {
  it('recovers two-decimal totals from float drift', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3)
    expect(roundMoney(1234.5600000001)).toBe(1234.56)
    expect(roundMoney(null)).toBe(0)
  })
})
