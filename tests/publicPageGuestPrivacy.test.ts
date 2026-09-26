import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

// Two public, sitemap-listed pages rendered member identities with none of the
// rules the sibling surfaces enforce. Both are server components that open a
// DB connection at module load, so the rules are pinned against the source —
// the same approach as visitingLocals.test.ts.

describe('/events/[id] guest structured data', () => {
  const page = readFileSync('app/events/[id]/page.tsx', 'utf-8')

  it('builds the guest JSON-LD from the redacted event', () => {
    // The visible guest UI withholds the street address and meeting link;
    // the <script type="application/ld+json"> in the same response carried
    // both verbatim for every logged-out visitor and crawler.
    expect(page).toMatch(/const guestJsonLd = buildEventJsonLd\(redactEventForGuest\(event\)/)
  })

  it('keeps online events online after redaction', () => {
    expect(page).toMatch(/online = !!event\.meetingUrl\)/)
    expect(page).toMatch(/url: event\.meetingUrl \?\? eventUrl/)
  })
})

describe('/neighborhoods/[slug] sections', () => {
  const src = readFileSync('app/neighborhoods/[slug]/NeighborhoodSections.tsx', 'utf-8')

  it('local members honour the opt-out, admin hiding and connections-only profiles', () => {
    expect(src).toMatch(/neighborhood: name, cityId, status: 'approved',\s*neighborhoodVisible: true, hiddenFromMembers: false,\s*\.\.\.\(viewer \? \{\} : \{ profileVisibility: \{ not: 'connections' \} \}\)/)
    expect(src).toMatch(/restrictedSetFor\(viewer, localCandidates\)/)
  })

  it('event attendee previews follow the event page: no stealth, no hidden, none for guests', () => {
    expect(src).toMatch(/where:\s*\{ status: 'approved', stealth: false, user: \{ status: 'approved', hiddenFromMembers: false \} \},\s*take:\s*myId \? 3 : 0/)
  })

  it('hangouts are member-only like the pulses', () => {
    expect(src).toMatch(/myId \? prisma\.hangout\.findMany\(/)
  })

  it("members-only visits stay off the public neighbourhood page, and a banned author's card goes with them", () => {
    expect(src).toMatch(/neighborhood: name, cityId, status: 'active', endsOn: \{ gte: today \},\s*\.\.\.\(myId \? \{\} : \{ visibility: 'public' \}\)/)
    expect(src).toMatch(/\{ OR: \[\{ userId: null \}, \{ user: \{ status: 'approved', hiddenFromMembers: false \} \}\] \}/)
  })

  it('never selects listing authors it does not render', () => {
    const block  = src.slice(src.indexOf('prisma.listing.findMany'), src.indexOf('prisma.visitorAnnouncement.findMany'))
    const select = block.slice(block.indexOf('select:'))
    expect(select).not.toContain('user:')
  })

  it('shows a guest the board question, not who asked', () => {
    expect(src).toContain("{myId ? firstNameOf(shown.name) : 'Smileys member'}")
  })

  it('receives the session so restrictedSetFor can run', () => {
    const page = readFileSync('app/neighborhoods/[slug]/page.tsx', 'utf-8')
    expect(page).toContain('viewer={session}')
  })
})

describe('host flags on event surfaces', () => {
  const db   = readFileSync('lib/db.ts', 'utf-8')
  const page = readFileSync('app/events/[id]/page.tsx', 'utf-8')
  const card = readFileSync('components/EventCard.tsx', 'utf-8')

  it('a guest never receives the host nationality', () => {
    // redactEventForGuest feeds the public list, the guest page and its JSON-LD.
    const redact = db.slice(db.indexOf('export function redactEventForGuest'))
    expect(redact.slice(0, redact.indexOf('\n}'))).toMatch(/hostNationality:\s*null/)
  })

  it('a connections-only host gets no flag, in lists or on the page', () => {
    // Same attribute the attendee grid withholds (memberPrivacy.restrictedSetFor).
    expect(db).toMatch(/hostNationality:\s*map\[e\.hostId\]\?\.profileVisibility === 'connections' \? null/)
    expect(page).toMatch(/c\.user\.profileVisibility !== 'connections' && countryFlag\(c\.user\.nationality\)/)
  })

  it('the flag renders beside the host name on the page and the card', () => {
    expect(page).toMatch(/countryFlag\(event\.hostNationality\)/)
    expect(card).toMatch(/countryFlag\(event\.hostNationality\)/)
  })
})
