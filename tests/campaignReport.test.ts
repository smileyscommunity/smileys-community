import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { validateEntryInput, summarize } from '@/lib/campaignReport'
import { posthogApiHost, ticketClicksFor } from '@/lib/posthogQuery'
import { validatePartnershipInput } from '@/lib/partnerships'

const read = (f: string) => readFileSync(f, 'utf8')
const TODAY = '2026-10-20'
const base = { source: 'organizer_report', reportedAt: '2026-10-18' }

describe('validateEntryInput', () => {
  it('a ticket sale needs a whole number, a source and a reporting date', () => {
    expect(validateEntryInput({ ...base, kind: 'tickets_sold', quantity: 12 }, TODAY)).toMatchObject({ ok: true, data: { quantity: 12, amount: null, source: 'organizer_report', reportedAt: '2026-10-18' } })
    expect(validateEntryInput({ ...base, kind: 'tickets_sold', quantity: 1.5 }, TODAY).ok).toBe(false)
    expect(validateEntryInput({ ...base, kind: 'tickets_sold', quantity: -1 }, TODAY).ok).toBe(false)
    expect(validateEntryInput({ ...base, kind: 'tickets_sold' }, TODAY).ok).toBe(false)
    expect(validateEntryInput({ kind: 'tickets_sold', quantity: 3, reportedAt: '2026-10-18' }, TODAY).ok).toBe(false) // no source
    expect(validateEntryInput({ kind: 'tickets_sold', quantity: 3, source: 'organizer_report' }, TODAY).ok).toBe(false) // no date
  })
  it('PostHog can never be the source of a sale or redemption — it counts clicks, not sales', () => {
    for (const kind of ['tickets_sold', 'discount_redemptions']) {
      const r = validateEntryInput({ kind, quantity: 5, source: 'posthog', reportedAt: '2026-10-18' }, TODAY)
      expect(r.ok).toBe(false)
    }
    expect(validateEntryInput({ kind: 'ticket_clicks', quantity: 5, source: 'posthog', reportedAt: '2026-10-18' }, TODAY).ok).toBe(true)
  })
  it('money needs an amount and a supported currency; counts reject an amount', () => {
    expect(validateEntryInput({ ...base, kind: 'expense', amount: 40.456, currency: 'EUR' }, TODAY)).toMatchObject({ ok: true, data: { amount: 40.46, currency: 'EUR', quantity: null } })
    expect(validateEntryInput({ ...base, kind: 'fee_received', amount: 100 }, TODAY).ok).toBe(false)
    expect(validateEntryInput({ ...base, kind: 'fee_received', amount: 100, currency: 'ZZZ' }, TODAY).ok).toBe(false)
    expect(validateEntryInput({ ...base, kind: 'fee_received', amount: -5, currency: 'EUR' }, TODAY).ok).toBe(false)
    expect(validateEntryInput({ ...base, kind: 'tickets_sold', amount: 10, currency: 'EUR' }, TODAY).ok).toBe(false)
  })
  it('refuses unknown kinds and sources, future reporting dates and reversed periods', () => {
    expect(validateEntryInput({ ...base, kind: 'revenue', quantity: 1 }, TODAY).ok).toBe(false)
    expect(validateEntryInput({ ...base, kind: 'tickets_sold', quantity: 1, source: 'rsvp' }, TODAY).ok).toBe(false)
    expect(validateEntryInput({ ...base, kind: 'tickets_sold', quantity: 1, reportedAt: '2026-11-01' }, TODAY).ok).toBe(false)
    expect(validateEntryInput({ ...base, kind: 'tickets_sold', quantity: 1, periodStart: '2026-10-10', periodEnd: '2026-10-01' }, TODAY).ok).toBe(false)
    expect(validateEntryInput('x', TODAY).ok).toBe(false)
  })
})

describe('summarize', () => {
  const e = (kind: string, extra: Record<string, unknown>) => ({ kind, quantity: null, amount: null, currency: null, reportedAt: '2026-10-01', source: 'organizer_report', ...extra })
  it('reports "not reported" (null) when nobody reported — never a zero', () => {
    const s = summarize([])
    expect(s.ticketsSold).toBeNull()
    expect(s.discountRedemptions).toBeNull()
    expect(s.received).toEqual([])
    expect(s.expenses).toEqual([])
  })
  it('a reported zero stays a zero', () => {
    expect(summarize([e('tickets_sold', { quantity: 0 })]).ticketsSold).toBe(0)
  })
  it('sums reports of the same kind, and sold tickets are independent of clicks', () => {
    const s = summarize([e('tickets_sold', { quantity: 4 }), e('tickets_sold', { quantity: 6 }), e('ticket_clicks', { quantity: 900 })])
    expect(s.ticketsSold).toBe(10)
    expect(s.manualTicketClicks).toBe(900)
  })
  it('keeps fee, commission and expenses apart and per currency, with no net or profit', () => {
    const s = summarize([
      e('fee_received', { amount: 500, currency: 'EUR' }), e('commission_received', { amount: 80.1, currency: 'EUR' }),
      e('fee_received', { amount: 3000, currency: 'TRY' }), e('expense', { amount: 120, currency: 'EUR' }), e('expense', { amount: 0.2, currency: 'EUR' }),
    ])
    expect(s.received).toEqual([{ currency: 'EUR', fee: 500, commission: 80.1 }, { currency: 'TRY', fee: 3000, commission: 0 }])
    expect(s.expenses).toEqual([{ currency: 'EUR', amount: 120.2 }])
    expect(Object.keys(s).join(',')).not.toMatch(/profit|net|revenue/i)
  })
})

describe('PostHog read (optional)', () => {
  it('maps the capture host to the API host', () => {
    expect(posthogApiHost('https://eu.i.posthog.com')).toBe('https://eu.posthog.com')
    expect(posthogApiHost('https://us.i.posthog.com/')).toBe('https://us.posthog.com')
  })
  it('returns null without credentials or with an unsafe slug (no query injection)', async () => {
    const saved = [process.env.POSTHOG_PERSONAL_API_KEY, process.env.POSTHOG_PROJECT_ID]
    delete process.env.POSTHOG_PERSONAL_API_KEY; delete process.env.POSTHOG_PROJECT_ID
    expect(await ticketClicksFor('some-article')).toBeNull()
    process.env.POSTHOG_PERSONAL_API_KEY = 'k'; process.env.POSTHOG_PROJECT_ID = '1'
    expect(await ticketClicksFor("x' OR 1=1 --")).toBeNull()
    ;[process.env.POSTHOG_PERSONAL_API_KEY, process.env.POSTHOG_PROJECT_ID] = saved as [string, string]
    if (saved[0] === undefined) delete process.env.POSTHOG_PERSONAL_API_KEY
    if (saved[1] === undefined) delete process.env.POSTHOG_PROJECT_ID
  })
})

describe('source tag and privacy', () => {
  it('a partnership source tag is a short [a-z0-9_-] label', () => {
    expect(validatePartnershipInput({ organizer: 'A', sourceTag: 'newsletter-oct' }, false).ok).toBe(true)
    for (const bad of ['Has Space', 'https://x.com', 'a?b=1', 'CODE15']) {
      expect(validatePartnershipInput({ organizer: 'A', sourceTag: bad }, false).ok).toBe(false)
    }
  })
  it('the enquiry API stores only a sanitized tag', () => {
    expect(read('app/api/partner-with-us/enquiry/route.ts')).toMatch(/\^\[a-z0-9_-\]\{1,40\}\$/)
    expect(read('app/api/partner-with-us/enquiry/route.ts')).toMatch(/campaignSource/)
  })
  it('the page stays cacheable: the tag is read in the browser, not via searchParams', () => {
    expect(read('app/partner-with-us/page.tsx')).not.toMatch(/searchParams/)
    expect(read('app/partner-with-us/PartnersEnquiryForm.tsx')).toMatch(/window\.location\.search/)
  })
  it('analytics never receive the ticket URL, a code or a tag-less full link', () => {
    expect(read('components/TicketLink.tsx')).toMatch(/\{ article_slug: slug, ticket_host: host \}/)
  })
})

describe('admin-only, audited, no public reads', () => {
  const routes = ['app/api/admin/partnership-reports/route.ts', 'app/api/admin/partnership-reports/export/route.ts']
  it('every report route is admin-only', () => {
    for (const f of routes) { const s = read(f); expect(s).toMatch(/isAdmin\(/); expect(s).toMatch(/status: 403/) }
    expect((read(routes[0]).match(/requireAdmin\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
  it('adds, deletes and exports are audited', () => {
    const s = routes.map(read).join('\n')
    for (const a of ['campaign_report.add', 'campaign_report.delete', 'campaign_report.export']) expect(s).toContain(a)
  })
  it('no public page or API reads the ledger', () => {
    const files = execSync(`grep -rlE "campaignReportEntry" app lib components`, { encoding: 'utf8' }).split('\n').filter(Boolean).sort()
    expect(files).toEqual(['app/api/admin/partnership-reports/export/route.ts', 'app/api/admin/partnership-reports/route.ts'])
  })
  it('the CSV exports are no-store and neutralise spreadsheet formulas', () => {
    const s = read(routes[1])
    expect(s).toMatch(/no-store/); expect(s).toMatch(/\[=\+\\-@/)
  })
  it('nothing in the reporting code sends messages', () => {
    for (const f of [...routes, 'lib/campaignReport.ts', 'app/admin/partnerships/reports/page.tsx']) expect(read(f)).not.toMatch(/resend|sendEmail|lib\/email|lib\/notify|whatsapp|mailto:/i)
  })
})
