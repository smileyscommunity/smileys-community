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

  it('never selects listing authors it does not render', () => {
    const block  = src.slice(src.indexOf('prisma.listing.findMany'), src.indexOf('prisma.visitorAnnouncement.findMany'))
    const select = block.slice(block.indexOf('select:'))
    expect(select).not.toContain('user:')
  })

  it('shows a guest the board question, not who asked', () => {
    expect(src).toContain("{myId ? firstNameOf(bp.user.name) : 'Smileys member'}")
  })

  it('receives the session so restrictedSetFor can run', () => {
    const page = readFileSync('app/neighborhoods/[slug]/page.tsx', 'utf-8')
    expect(page).toContain('viewer={session}')
  })
})
