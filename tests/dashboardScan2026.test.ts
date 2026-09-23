import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-09-23, full dashboard scan. The page had grown ~40 queries and ~25
// strips with no test touching any of its arithmetic, and the scan found the
// predictable result: numbers that disagreed with the list underneath them,
// headings that claimed things the query couldn't support, and one more
// instance of the leak that has now been found four times — a first name on
// the screen and a full name on the wire.

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const src  = read('app/(member)/dashboard/page.tsx')

describe('nobody is shown who did not agree to be shown', () => {
  it('the "free right now" pulses go through the same projection as the rest', () => {
    // /api/availability redacts these very rows; the dashboard was the copy
    // that was missed — photo, full name in alt, and a surname initial.
    expect(src).toContain('profilePhoto: true, profileVisibility: true } },')
    expect(src).toContain('...recentPulses.map(p => p.user),')
    // Selecting the column and building a projection proves nothing on its
    // own — the projection has to consult `restricted` and drop the photo.
    expect(src).toContain('const shownPulses = recentPulses.map((p) => ({')
    expect(src).toMatch(/shownPulses[\s\S]{0,400}restricted\.has\(p\.user\.id\)[\s\S]{0,200}profilePhoto: null/)
    expect(src).toContain('alt={firstNameOf(p.user.name)}')
    expect(src).not.toMatch(/alt=\{p\.user\.name\}/)
  })

  it('and the timeline feeds it, so both surfaces cannot drift apart', () => {
    expect(src).toContain('pulses={shownPulses}')
  })

  it('the activity wall builds its discs from a first name', () => {
    // Fifteen feeds reach this component and none selects profileVisibility,
    // so a per-person decision is impossible here — one initial is the answer
    // that is right for all of them, and it matches the label beside it.
    expect(read('components/ClubActivityTimeline.tsx')).toContain('{getInitials(firstNameOf(name))}')
  })

  it('a neighbourhood opt-out is honoured wherever the neighbourhood prints', () => {
    // The suggestion match has two branches and only the neighbourhood one
    // required the opt-in, so a member found through a shared club had their
    // district shown regardless.
    expect(src).toContain('neighborhood: m.neighborhoodVisible ? m.neighborhood : null')
    expect(src).toContain('neighborhood: spotlightUser.neighborhoodVisible ? spotlightUser.neighborhood : null')
  })

  it('a visiting card cannot carry a surname the author redaction removed', () => {
    // The name field is free text and was prefilled with the full account
    // name, so hiding the author left the surname on the card.
    // Now routed through lib/visitorPolicy's visitorName — see the shared-
    // helper block below for the surfaces it covers.
    expect(src).toContain('name: visitorName(v.name)')
    expect(read('app/visiting/page.tsx')).toContain('name:         visitorName(a.name),')
    expect(read('app/(member)/visiting/new/page.tsx')).toContain('setName(firstNameOf(user.name))')
  })

  it('an anonymous visiting card is not silently dropped by a NOT IN', () => {
    // `userId NOT IN (…)` is NULL, and therefore false, for a null author —
    // the same shape that once emptied member discovery.
    expect(src).toContain('{ OR: [{ userId: null }, { userId: { notIn: notMeOrBlocked } }] },')
  })
})

describe('the numbers say what the page underneath them says', () => {
  it('the Upcoming tile counts what the list shows', () => {
    // A separate count() over the unfiltered where meant sixteen people
    // holding a seat at a 12:00–17:00 event read "Upcoming 1" at 17:01,
    // directly above "No upcoming events".
    expect(src).toContain('const upcomingCount = upcomingRaw.filter(a => eventEndsAt(a.event, tz).getTime() > Date.now()).length')
    expect(src).not.toContain('prisma.eventAttendee.count({ where: upcomingWhere })')
  })

  it('and the end-of-day filter is not cut off by the page size', () => {
    // Pinned by value rather than by surrounding punctuation: the earlier
    // version matched exact indentation and broke on a reformat while the
    // property it named stayed true.
    expect(src).toMatch(/const upcomingRaw = await prisma\.eventAttendee\.findMany\(\{[\s\S]{0,900}take: 60,/)
  })

  it('"events so far" counts events that actually happened', () => {
    expect(src).toContain("a.attendance !== 'no_show'\n                                                  && (a.event.status === 'published' || a.event.status === 'archived')")
  })

  it('"going" is the approved count, not spot arithmetic', () => {
    // Selected all along and used by the sort; the badge did its own sum and
    // read "21 going" for an event with one attendee.
    expect(src).toContain('{event._count.attendees} going')
    expect(src).not.toContain('{event.totalSpots - event.spotsLeft} going')
  })

  it('"this week" is seven days and "next 30 days" is thirty', () => {
    expect(src).toContain('const weekEndStr  = shiftDay(today, 6)')
    expect(src).toContain('const monthEndStr = shiftDay(today, 29)')
  })

  it('the free-right-now claim admits its own cap', () => {
    expect(src).toContain("shownPulses.length === PULSE_TAKE ? '+' : ''")
  })
})

describe('headings do not promise what the query cannot deliver', () => {
  it('"from your clubs, interests and neighbourhood" needs a match, not just signals', () => {
    // Every card, not just the top one: the list is score-sorted, so keying
    // on [0] let one match label four cards, three of which the widened pool
    // now often fills with score-zero events.
    expect(src).toContain("deduplicatedRecommended.length > 0 && deduplicatedRecommended.every(e => e.score > 0)")
  })

  it('a field of one is not ranked as the most popular', () => {
    // The first version of this guard counted the RAW pool, before the
    // featured dedupe — so four candidates could still render one card under
    // "most popular" — and never looked at attendance, so four events nobody
    // had joined were ranked as a top four of "0 going". The property is that
    // the gate reads the array that renders, and that someone is on it.
    expect(src).toContain('const trendingRanked = trendingEventsRaw')
    expect(src).toContain('trendingRanked.length >= TRENDING_MIN_FIELD && (trendingRanked[0]?._count.attendees ?? 0) > 0')
    expect(src).not.toContain('trendingEventsRaw.length >= TRENDING_MIN_FIELD')
  })

  it('the poll no longer claims a weekly cadence nothing enforces', () => {
    // The live poll has been up since May — nineteen weeks of "of the week".
    const widget = read('components/CommunityPollWidget.tsx')
    expect(widget).not.toContain('Poll of the week')
    expect(widget).toContain('Community poll')
  })

  it('the empty-city block does not promise weekly events to a city with none', () => {
    const block = read('components/FirstEventBlock.tsx')
    expect(block).not.toContain('New events pop up across the city every week')
  })

  it('a randomly rotated listing is not labelled "new"', () => {
    expect(src).not.toContain('New on Board')
    expect(src).toContain('From the Marketplace')
  })
})

describe('the same thing is not rendered twice on one page', () => {
  it('articles are pinned in one place, not in the timeline as well', () => {
    // Every article in "From Smileys" was also a pinned timeline row, a few
    // hundred pixels away in the same column.
    expect(src).not.toContain('articles={recentArticles}')
  })

  it('and the handbook list belongs to the strip with room for it', () => {
    // Two articles were rendering in both the left rail and the centre column
    // at every breakpoint.
    expect(src.match(/latestHandbook\.map/g) ?? []).toHaveLength(1)
  })
})

describe('a visitor card carries one name everywhere', () => {
  it('through a shared helper, so the surfaces cannot disagree', () => {
    // The cut had landed on two of five member-facing surfaces: the same card
    // read "Maria" on /visiting and "Maria Gonzalez" on the city hub.
    expect(read('lib/visitorPolicy.ts')).toContain('export function visitorName(name: string): string')
    for (const f of [
      'app/api/visitors/route.ts',
      'app/[city]/data.ts',
      'app/neighborhoods/page.tsx',
      'app/neighborhoods/[slug]/NeighborhoodSections.tsx',
      'app/visiting/page.tsx',
      'app/(member)/dashboard/page.tsx',
    ]) expect(read(f)).toContain('visitorName(')
  })

  it('and the client strip is not handed a name it never renders', () => {
    expect(read('components/DashboardVisitorsStrip.tsx')).not.toContain('  name:         string')
  })
})

describe('the city calendar, not the server clock', () => {
  it('"member since" and "joined today" are days in the city', () => {
    expect(src).toContain("{ month: 'long', year: 'numeric', timeZone: tz }")
    expect(src).toContain('const joinedDay = dayInTz(new Date(m.joinedAt), tz)')
  })

  it('and nothing on the page hand-rolls initials any more', () => {
    expect(src).not.toMatch(/name\.split\(' '\)\.map\(\(w: string\) => w\[0\]\)/)
    expect(src).not.toContain("name.trim().split(' ')")
  })
})
