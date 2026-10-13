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
    const src = read('app/partners/page.tsx') + read('lib/partners.ts')
    expect(src.toLowerCase()).not.toMatch(/youngr.{0,40}giveaway|giveaway.{0,40}youngr/)
  })
})
