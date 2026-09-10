import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

// Rules pinned against the source because they live in server components or
// in one-line details of routes whose other behaviour is tested elsewhere.
// Each maps to a finding from the 2026-09-10 bug scan.

const read = (p: string) => readFileSync(p, 'utf-8')

describe('rate limits key on the trusted address', () => {
  it.each([
    'app/api/events/route.ts',
    'app/api/directory/route.ts',
    'app/api/neighborhoods/route.ts',
  ])('%s uses getIp, not the first X-Forwarded-For hop', (file) => {
    const src = read(file)
    expect(src).not.toMatch(/x-forwarded-for'\)\?\.split\(','\)\[0\]/)
    expect(src).toMatch(/const ip = getIp\(req\)/)
  })
})

describe('/visiting locals', () => {
  const page = read('app/visiting/page.tsx')
  it('excludes admin-hidden accounts and connections-only profiles for guests', () => {
    expect(page).toMatch(/status: 'approved', cityId: cityId, hiddenFromMembers: false,\s*\.\.\.\(session \? \{\} : \{ profileVisibility: \{ not: 'connections' \} \}\)/)
  })
  it('applies restrictedSetFor for members', () => {
    expect(page).toMatch(/restrictedSetFor\(session, localCandidates\)/)
  })
  it('never ships profileVisibility to the client', () => {
    expect(page).toMatch(/featuredLocals\.map\(\(\{ profileVisibility: _pv, \.\.\.rest \}\) => rest\)/)
  })
})

describe('/events/[id] member view', () => {
  const page = read('app/events/[id]/page.tsx')
  it('gates the waitlist nationality flag like the attendee grid', () => {
    expect(page).toMatch(/const restrictedWaitlist = await restrictedSetFor\(session, waitlisted\.users\)/)
    expect(page).toMatch(/restrictedWaitlist\.has\(u\.id\) \? '' : countryFlag\(u\.nationality\)/)
  })
  it('passes the manual sold-out flag to the mobile sticky bar too', () => {
    const sticky = page.slice(page.indexOf('Sticky RSVP bar'))
    expect(sticky).toMatch(/<RSVPButton[\s\S]*?soldOut=\{soldOut\}/)
  })
})

describe('GET /api/events/[id] for a non-attendee', () => {
  it('strips the coordinates along with the address', () => {
    const src = read('app/api/events/[id]/route.ts')
    expect(src).toMatch(/const \{ whatsappUrl, meetingUrl, address, paymentContact, \.\.\.publicEvent \} = event as any/)
    expect(src).toMatch(/\{ \.\.\.publicEvent, lat: null, lng: null \}/)
  })
})

describe('member discovery', () => {
  it('excludes admin-hidden accounts like every other people surface', () => {
    const src = read('app/api/members/discovery/route.ts')
    expect(src).toMatch(/const visibleWhere = \{[\s\S]*?hiddenFromMembers: false,/)
  })
})

describe('newsletter digest escaping', () => {
  it('escapes quotes, since titles land in attributes', () => {
    const src = read('lib/newsletterDigest.ts')
    expect(src).toMatch(/const esc = .*&quot;.*&#39;/)
  })
})

describe('directory "Open now" runs on the listed city\'s clock', () => {
  it('detail page passes the business city timezone', () => {
    const src = read('app/directory/[id]/page.tsx')
    expect(src).toMatch(/getOpenStatus\(hours, businessCity\.timezone \?\? DEFAULT_TZ\)/)
    expect(src).toMatch(/todayInTz\(businessCity\.timezone \?\? DEFAULT_TZ\)/)
  })
  it('directory cards pass the viewed city timezone', () => {
    const src = read('app/directory/DirectoryClient.tsx')
    expect(src).toMatch(/getOpenStatus\(b\.hours, tz\)/)
    expect(src).toMatch(/tz=\{viewCity\?\.timezone\}/)
  })
})

describe('role and status changes revoke the live session', () => {
  it('partner assign/unassign bump tokenVersion', () => {
    const src = read('app/api/admin/partners/[id]/route.ts')
    expect(src).toMatch(/role: 'partner', tokenVersion: \{ increment: 1 \}/)
    expect(src).toMatch(/role: 'member', tokenVersion: \{ increment: 1 \}/)
  })
  it('application rejection bumps tokenVersion', () => {
    const src = read('app/api/admin/applications/route.ts')
    expect(src).toMatch(/status: 'pending', tokenVersion: \{ increment: 1 \}/)
  })
  it('application approval reports an account-setup failure instead of a silent 200', () => {
    const src = read('app/api/admin/applications/route.ts')
    expect(src).toMatch(/let accountError: unknown = null\s*\n\s*await \(async \(\) => \{/)
    expect(src).toMatch(/if \(accountError\) \{[\s\S]*?status: 500/)
  })
})

describe('board interactions and listing alerts respect blocks and standing', () => {
  it.each(['app/api/board/[id]/replies/route.ts', 'app/api/board/[id]/react/route.ts'])('%s checks blocks before notifying', (file) => {
    expect(read(file)).toMatch(/isBlockedEitherWay\(session\.id, post\.userId\)/)
  })
  it.each(['app/api/listings/route.ts', 'app/api/moving-sales/route.ts'])('%s only alerts approved, non-blocking members', (file) => {
    const src = read(file)
    expect(src).toMatch(/listingAlerts: \{ has: [^}]*\}[\s\S]*?status: 'approved',[\s\S]*?blocksGiven: \{ none: \{ blockedId: session\.id \} \}, blocksReceived: \{ none: \{ blockerId: session\.id \} \}/)
  })
})
