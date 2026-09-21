import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { normalizeListingContact } from '@/lib/listingContact'
import { likeSafe } from '@/lib/turkishFold'

// The marketplace review (2026-09-21), server side. A logged-out visitor
// could search the full description and read the result count back, one
// character at a time, until they had the phone number the teaser cuts off;
// a banned seller's listing kept that number on the marketplace for thirty
// days; the feed showed a connections-only seller in full while the same
// listing's permalink showed a first name; and "Contact on WhatsApp" could
// point anywhere.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('what a guest can ask', () => {
  const route = src('app/api/listings/route.ts')

  it('searches titles only, with the wildcards escaped', () => {
    expect(route).toContain('{ title: { contains: likeSafe(q), mode: \'insensitive\' as const } }')
    expect(likeSafe('%+905_')).toBe('\\%+905\\_')
  })

  it('never sees a number or an email in the teaser, nor the seller id', () => {
    const lib = src('lib/listingsPublic.ts')
    expect(lib).toContain('const safe = redactBoardTextForGuest(listing.description)')
    expect(lib).toContain('const { userId: _omitUserId, ...rest } = listing')
  })

  it('a moving sale\'s note is redacted too — the neighbourhood is withheld for a reason', () => {
    const sales = src('app/api/moving-sales/route.ts')
    expect(sales).toContain('note: session ? s.note : (s.note ? redactBoardTextForGuest(s.note) : null),')
    expect(sales).toContain('items: session ? s.items : s.items.map(i => ({ ...i, name: redactBoardTextForGuest(i.name) })),')
  })
})

describe('whose listing it is', () => {
  it('a banned, suspended or hidden seller drops off the marketplace', () => {
    expect(src('app/api/listings/route.ts')).toContain('user: LIVE_BOARD_AUTHOR,')
    expect(src('app/api/listings/[id]/route.ts')).toContain("where: { id, status: 'active', expiresAt: { gte: new Date() }, user: LIVE_BOARD_AUTHOR },")
  })

  it('a blocked pair sees nothing of each other', () => {
    expect(src('app/api/listings/route.ts')).toContain('...(blockedIds.length ? { userId: { notIn: blockedIds } } : {}),')
    expect(src('app/api/listings/[id]/route.ts')).toContain('if (session && listing.user && await isBlockedEitherWay(session.id, listing.user.id)) {')
  })

  it('a connections-only seller is a first name, as on the permalink', () => {
    expect(src('app/api/listings/route.ts')).toContain('const show = await authorProjector(session, listings.flatMap(l => (l.user ? [l.user] : [])))')
    expect(src('app/api/listings/[id]/route.ts')).toContain('const show = await authorProjector(session, listing.user ? [listing.user] : [])')
  })

  it('reading the marketplace has a budget', () => {
    expect(src('app/api/listings/route.ts')).toContain('rateLimit(`listings-browse:${session?.id ?? getIp(req)}`, 120, 60_000)')
  })
})

describe('the contact button', () => {
  it('takes a phone number or WhatsApp, and nothing else', () => {
    expect(normalizeListingContact('+90 555 111 22 33')).toEqual({ ok: true, value: '+90 555 111 22 33' })
    expect(normalizeListingContact('https://wa.me/905551112233').ok).toBe(true)
    expect(normalizeListingContact('')).toEqual({ ok: true, value: null })
    // As people actually paste them: iOS wraps a copied number in bidi marks,
    // autocorrect turns hyphens into en-dashes, some keyboards give a
    // full-width plus, and the placeholder itself offers a bare wa.me link.
    expect(normalizeListingContact('\u202a+90 555 123 45 67\u202c')).toEqual({ ok: true, value: '+90 555 123 45 67' })
    expect(normalizeListingContact('+90 555–123–45–67')).toEqual({ ok: true, value: '+90 555-123-45-67' })
    expect(normalizeListingContact('＋90 555 123 45 67')).toEqual({ ok: true, value: '+90 555 123 45 67' })
    expect(normalizeListingContact('wa.me/905551234567')).toEqual({ ok: true, value: 'https://wa.me/905551234567' })
    expect(normalizeListingContact('0555 123 45 67 / 0532 111 22 33').ok).toBe(true)
    // The lure: a green WhatsApp-branded button pointing at a login page.
    expect(normalizeListingContact('http://wa-me-verify.example/login').ok).toBe(false)
    expect(normalizeListingContact('https://evil.example/whatsapp').ok).toBe(false)
    expect(normalizeListingContact('http://wa.me/905551112233').ok).toBe(false)   // https only
    expect(normalizeListingContact('ask me').ok).toBe(false)
  })

  it('is checked on both the create and the edit paths', () => {
    expect(src('app/api/listings/route.ts')).toContain('const checkedContact = normalizeListingContact(contact)')
    expect(src('app/api/listings/[id]/route.ts')).toContain('const checked = normalizeListingContact(contact)')
  })

  it("is the seller's to set — staff edit the listing, not where the money goes", () => {
    const route = src('app/api/listings/[id]/route.ts')
    expect(route).toContain('if (isCityModerator && (contactChanged || contactEmailChanged)) {')
    // Only a CHANGE counts: the form sends every field back, so re-checking
    // a stored value refused a moderator's title fix and an owner's own edit
    // when the number predated the rule.
    expect(route).toContain("const contactChanged      = 'contact'      in body && (body.contact      ?? null) !== (listing.contact      ?? null)")
    // …and a staff edit leaves a trail, which this route never wrote.
    expect(route).toContain("'listing.staff_edit'")
  })
})

describe('the rest of the listing', () => {
  it('a price is text, capped, and never a number that throws', () => {
    expect(src('app/api/listings/route.ts')).toContain("price: typeof price === 'string' && price.trim() ? price.trim().slice(0, 50) : null,")
    expect(src('app/api/listings/[id]/route.ts')).toContain("data.price = typeof price === 'string' && price.trim() ? price.trim().slice(0, 50) : null")
  })

  it('renewing does not resurrect something already sold', () => {
    expect(src('app/api/listings/[id]/route.ts')).toContain("if (listing.status === 'filled') {")
  })

  it('"mine" hides what a moderator removed rather than showing it as live', () => {
    const route = src('app/api/listings/route.ts')
    expect(route).toContain("const statusFilter = mine && session ? { status: { not: 'deleted' } }")
    // …and Saved keeps sold and expired rows, with their status, so the page
    // can say "3 saved listings are no longer available" instead of dropping
    // them without a word.
    expect(route).toContain(": saved && session ? { status: { in: ['active', 'filled', 'expired'] } }")
  })

  it('saving checks the listing exists and can be seen', () => {
    const save = src('app/api/listings/[id]/save/route.ts')
    expect(save).toContain("where:  { id: listingId, status: 'active', expiresAt: { gte: new Date() }, user: LIVE_BOARD_AUTHOR },")
    expect(save).toContain('rateLimit(`listing-save:${session.id}`, 60, 60_000)')
    // Only the double-tap is forgiven; a database failure is not a save.
    expect(save).toContain("e.code === 'P2002'")
  })

  it('a listing past its date is not live anywhere, and a dead one keeps no number in Saved', () => {
    const route = src('app/api/listings/route.ts')
    expect(route).toContain(": { status: 'active', expiresAt: { gte: new Date() } }")
    expect(route).toContain("...(dead(l) && l.userId !== session.id ? { contact: null, contactEmail: null } : {}),")
    expect(src('app/api/listings/[id]/route.ts')).toContain("where: { id, status: 'active', expiresAt: { gte: new Date() }, user: LIVE_BOARD_AUTHOR },")
    expect(src('app/sitemap.ts')).toContain("where:   { status: 'active', expiresAt: { gte: new Date() }, cityId: { in: cityIds }, user: LIVE_BOARD_AUTHOR },")
  })

  it('the link preview shows a guest exactly what the page shows a guest', () => {
    const page = src('app/board/[id]/page.tsx')
    expect(page).toContain('redactBoardTextForGuest(listing.description).slice(0, TEASER_DESCRIPTION_LIMIT)')
    // A removed listing resolves no title, price or photo into a <head>.
    expect(page).toContain("if (availability === 'gone') return {}")
    // The owner who arrives from the expiry notice can renew from here.
    expect(page).toContain('Renew for 30 days →')
    // Live sellers only, blocked pairs excluded — the JSON rules, here too.
    expect(page).toContain('where: { id, user: LIVE_BOARD_AUTHOR },')
    expect(page).toContain('if (session && raw.user && await isBlockedEitherWay(session.id, raw.user.id)) notFound()')
  })
})

describe('the alert email', () => {
  it('links the thing it is announcing, and unsubscribes where the switch is', () => {
    const email = src('lib/email.ts')
    expect(email).toContain("path = '/marketplace',")
    expect(email).toContain('const url = `${APP_URL}${path}`')
    expect(email).toContain('const unsub = `${APP_URL}/marketplace`')
    expect(src('app/api/listings/route.ts')).toContain('`/board/${listing.id}`)')
    expect(src('app/api/moving-sales/route.ts')).toContain('`/moving-sales/${sale.id}`)')
    // …and it stops calling the marketplace the Community Board.
    expect(email).not.toContain('View on Community Board')
    expect(email).not.toContain('will be removed from the Community Board')
  })
})
