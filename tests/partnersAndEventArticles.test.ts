import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseEventDetails, ticketHost } from '@/lib/postEventDetails'

const read = (f: string) => readFileSync(f, 'utf8')

describe('parseEventDetails', () => {
  it('keeps only valid, supplied facts and infers nothing', () => {
    const d = parseEventDetails({ eventDate: '2026-11-02', startTime: '20:30', venue: ' Zorlu PSM ', ticketUrl: 'https://tickets.example.com/e/1', bogus: 'x' })
    expect(d).toEqual({ eventDate: '2026-11-02', startTime: '20:30', timeConfirmed: false, venue: 'Zorlu PSM', ticketUrl: 'https://tickets.example.com/e/1' })
  })
  it('marks a time confirmed only when told so', () => {
    expect(parseEventDetails({ startTime: '19:00', timeConfirmed: true })?.timeConfirmed).toBe(true)
  })
  it('drops unsafe or non-https ticket links and bad dates/times', () => {
    expect(parseEventDetails({ ticketUrl: 'javascript:alert(1)' })).toBeNull()
    expect(parseEventDetails({ ticketUrl: 'http://x.com' })).toBeNull()
    expect(parseEventDetails({ eventDate: '02/11/2026', startTime: '25:00' })).toBeNull()
  })
  it('rejects non-objects', () => {
    expect(parseEventDetails(null)).toBeNull()
    expect(parseEventDetails('x')).toBeNull()
    expect(parseEventDetails([])).toBeNull()
  })
  it('ticketHost exposes the host only', () => {
    expect(ticketHost('https://www.bilet.com/path?code=SECRET')).toBe('bilet.com')
  })
})

describe('private member offer isolation', () => {
  it('Post/PostMemberOffer are never read by public page code except via the guarded route', () => {
    const page = read('app/posts/[slug]/page.tsx')
    // The page may only ask whether an offer exists, never select its fields.
    expect(page).not.toMatch(/postMemberOffer[\s\S]{0,200}select:\s*\{[^}]*\b(url|code)\b/)
    expect(page).not.toMatch(/include:[^\n]*memberOffer/)
  })
  it('the offer route checks the session and membership on the server', () => {
    const route = read('app/api/posts/[slug]/offer/route.ts')
    expect(route).toMatch(/getSession\(\)/)
    expect(route).toMatch(/ACTIVATED_MEMBER_WHERE/)
    expect(route).toMatch(/no-store/)
  })
  it('analytics for offers and tickets never carry a URL or code', () => {
    expect(read('components/MemberOffer.tsx')).toMatch(/track\('member_offer_reveal', \{ article_slug: slug \}\)/)
    expect(read('components/TicketLink.tsx')).toMatch(/\{ article_slug: slug, ticket_host: host \}/)
  })
  it('the partnerships page never mentions a Youngr giveaway or discount code', () => {
    const src = read('app/partner-with-us/page.tsx') + read('lib/partners.ts')
    expect(src.toLowerCase()).not.toMatch(/youngr.{0,40}giveaway|giveaway.{0,40}youngr/)
  })
})

describe('admin sponsors inbox', () => {
  it('revenue is computed server-side over sponsor leads only, archived deals included', () => {
    const api = read('app/api/admin/sponsors/route.ts')
    expect(api).toMatch(/where: \{ status: 'won', \.\.\.kindWhere\('sponsors'\) \}/)
    expect(api).toMatch(/OR: \[\{ source: null \}, \{ source: \{ not: 'partners' \} \}\]/)
  })
  it('the admin badge counts only still-new leads and only for admins', () => {
    const r = read('app/api/admin/mod-stats/route.ts')
    expect(r).toMatch(/isAdmin\(session\) \? await prisma\.sponsorLead\.count\(\{ where: \{ status: 'new' \} \}\) : 0/)
  })
})

import { validateEventDetailsInput } from '@/lib/postEventDetails'

describe('validateEventDetailsInput (admin editor)', () => {
  it('undefined leaves the column alone; null or an empty form clears it', () => {
    expect(validateEventDetailsInput(undefined)).toEqual({ ok: true, data: undefined })
    expect(validateEventDetailsInput(null)).toEqual({ ok: true, data: null })
    expect(validateEventDetailsInput({ eventDate: '', venue: '  ', timeConfirmed: true })).toEqual({ ok: true, data: null })
  })
  it('accepts filled valid fields', () => {
    const r = validateEventDetailsInput({ eventDate: '2026-11-04', startTime: '21:30', timeConfirmed: true, venue: 'Fiba Salon', ticketUrl: 'https://passo.com.tr/x' })
    expect(r).toMatchObject({ ok: true, data: { eventDate: '2026-11-04', startTime: '21:30', timeConfirmed: true, venue: 'Fiba Salon' } })
  })
  it('names the field that failed instead of silently dropping it', () => {
    const r = validateEventDetailsInput({ venue: 'Hall', ticketUrl: 'http://insecure.example.com', startTime: '9pm' })
    expect(r.ok).toBe(false)
    expect((r as { error: string }).error).toMatch(/Ticket link/)
    expect((r as { error: string }).error).toMatch(/Start time/)
  })
  it('rejects a non-object', () => {
    expect(validateEventDetailsInput('x').ok).toBe(false)
    expect(validateEventDetailsInput([]).ok).toBe(false)
  })
  it('the save routes refuse a card that contains the private member offer', () => {
    expect(read('app/api/admin/posts/[id]/route.ts')).toMatch(/postMemberOffer\.findUnique/)
    expect(read('app/api/admin/posts/[id]/route.ts')).toMatch(/private member offer/)
  })
})

describe('partnership enquiry + export (step 1)', () => {
  it('only name, org, email, interest and message are required; event/venue/budget are optional', () => {
    const r = read('app/api/partner-with-us/enquiry/route.ts')
    expect(r).toMatch(/if \(!name \|\| !org \|\| !email \|\| !collab \|\| !message\)/)
    expect(r).toMatch(/eventVenue: eventVenue \|\| null, budgetRange: budgetRange \|\| null/)
    expect(r).toMatch(/verifyTurnstile/)
    expect(r).toMatch(/rateLimit\(/)
  })
  it('the three requested offers are selectable interests', async () => {
    const { COLLAB_LABELS } = await import('@/lib/partners')
    expect(COLLAB_LABELS.promote_event).toBe('Promote an event')
    expect(COLLAB_LABELS.monthly_partner).toBe('Become a monthly partner')
    expect(COLLAB_LABELS.sponsor_experience).toBe('Sponsor a Smileys experience')
  })
  it('the CSV export is admin-only, no-store, and neutralises spreadsheet formulas', () => {
    const r = read('app/api/admin/sponsors/export/route.ts')
    expect(r).toMatch(/!isAdmin\(session\)\) return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}/)
    expect(r).toMatch(/no-store/)
    expect(r).toMatch(/\[=\+\\-@/)
  })
  it('the scrub script clears the new contact-adjacent columns', () => {
    expect(read('scripts/scrub-old-sponsor-leads.ts')).toMatch(/eventVenue: null, budgetRange: null/)
  })
})

import { validateDisclosureInput, getDisclosure, DISCLOSURES } from '@/lib/postDisclosure'
import { execSync } from 'child_process'

describe('article paid-relationship disclosure (step 2)', () => {
  it('undefined leaves the column alone; null or empty clears; unknown values are refused', () => {
    expect(validateDisclosureInput(undefined)).toEqual({ ok: true, data: undefined })
    expect(validateDisclosureInput(null)).toEqual({ ok: true, data: null })
    expect(validateDisclosureInput('')).toEqual({ ok: true, data: null })
    expect(validateDisclosureInput('sponsored')).toEqual({ ok: true, data: 'sponsored' })
    expect(validateDisclosureInput('affiliate')).toEqual({ ok: true, data: 'affiliate' })
    expect(validateDisclosureInput('partner').ok).toBe(false)
    expect(validateDisclosureInput(7).ok).toBe(false)
  })
  it('only known values render a label; anything else shows nothing', () => {
    expect(getDisclosure('sponsored')?.label).toBe('Sponsored content')
    expect(getDisclosure('bogus')).toBeNull()
    expect(getDisclosure(null)).toBeNull()
    for (const d of DISCLOSURES) expect(d.text.length).toBeGreaterThan(20)
  })
  it('the public article renders the label from the stored column, not from content', () => {
    const page = read('app/posts/[slug]/page.tsx')
    expect(page).toMatch(/getDisclosure\(post\.disclosure\)/)
    expect(page).toMatch(/\{disclosure && \(/)
  })
  it('only the staff editor routes can set it; member submissions cannot', () => {
    expect(read('app/api/admin/posts/route.ts')).toMatch(/validateDisclosureInput\(payload\.disclosure\)/)
    expect(read('app/api/admin/posts/[id]/route.ts')).toMatch(/validateDisclosureInput\(payload\.disclosure\)/)
    expect(read('app/api/posts/submit/route.ts')).not.toMatch(/disclosure/)
    expect(read('app/api/posts/mine/[id]/route.ts')).not.toMatch(/disclosure/)
  })
})

describe('restricted member offer stays out of every public surface', () => {
  it('only the guarded offer route, the article page (existence check), staff admin and scripts touch the offer table', () => {
    const files = execSync(`grep -rlE "postMemberOffer|memberOffer" app lib components`, { encoding: 'utf8' }).split('\n').filter(Boolean).sort()
    expect(files).toEqual([
      'app/api/admin/posts/[id]/route.ts',
      'app/api/posts/[slug]/offer/route.ts',
      'app/posts/[slug]/page.tsx',
    ])
  })
  it('the article page only checks that an offer exists (select id), and members get it from a no-store route', () => {
    const page = read('app/posts/[slug]/page.tsx')
    expect(page).toMatch(/postMemberOffer\.findFirst\(\{ where: \{ postId: post\.id, active: true \}, select: \{ id: true \} \}\)/)
    expect(read('app/api/posts/[slug]/offer/route.ts')).toMatch(/no-store/)
  })
  it('metadata, sitemap, OG image and view beacon never mention the offer', () => {
    for (const f of ['app/sitemap.ts', 'app/api/og/route.tsx', 'app/api/posts/[slug]/view/route.ts']) {
      let src = ''
      try { src = read(f) } catch { continue }
      expect(src).not.toMatch(/memberOffer|postMemberOffer/i)
    }
    const page = read('app/posts/[slug]/page.tsx')
    const meta = page.slice(page.indexOf('generateMetadata'), page.indexOf('export default'))
    expect(meta).not.toMatch(/offer/i)
  })
  it('analytics events carry no URL or code', () => {
    const track = read('components/MemberOffer.tsx') + read('components/TicketLink.tsx')
    expect(track).not.toMatch(/track\([^)]*(url|code|href)/i)
  })
  it('the leak check script covers the body, excerpt, cover and event card of every post', () => {
    expect(read('scripts/check-private-offer-leaks.ts')).toMatch(/eventDetails/)
  })
})

describe('admin inbox labels every partnership interest', () => {
  it('each /partner-with-us interest has a readable label in Admin → Sponsors', async () => {
    const { COLLAB_TYPES } = await import('@/lib/partners')
    const admin = read('app/admin/sponsors/page.tsx')
    for (const c of COLLAB_TYPES) expect(admin, `missing label for partner_${c.value}`).toContain(`partner_${c.value}:`)
  })
})
