import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-09-23. "Who's going 👀" on the dashboard had no test of any kind, and
// two reviews found the same shape of problem the neighbourhoods pass had just
// closed: a first name on the screen and a full name on the wire, and a
// visibility rule the widget never applied because it never selected the
// column it would need.
//
// The bigger finding was a product one. The widget listed faces at events the
// viewer had NOT joined — by construction, every roster /events/<id> refuses
// that same viewer, who gets blurred discs and "RSVP to see who". It now shows
// who you know at the events you are already going to, which is both the
// useful question and one the viewer is already entitled to the answer to.

const src = readFileSync(join(__dirname, '..', 'app/(member)/dashboard/page.tsx'), 'utf8')

describe("who's going is about the events you're going to", () => {
  it('reads the rosters of the viewer\'s own upcoming events', () => {
    expect(src).toContain('const myUpcomingEventIds = upcomingAttendances.map((a) => a.eventId)')
    expect(src).toContain('eventId: { in: myUpcomingEventIds },')
    expect(src).toContain('myUpcomingEventIds.length > 0 && pastEventIds.length > 0')
  })

  it('no longer trawls the events the viewer has not joined', () => {
    // The old filter. Every row it produced was a roster the event page
    // blurs for that viewer — including events a host removed them from.
    expect(src).not.toContain("event: { cityId, date: { gte: today }, status: 'published', id: { notIn: joinedEventIds } },\n            user: { ...LIVE")
    expect(src).not.toMatch(/whosGoing[\s\S]{0,400}id: \{ notIn: joinedEventIds \}/)
  })

  it('and inherits the "already ended" rule rather than re-deriving it', () => {
    // upcomingAttendances is filtered on eventEndsAt, so a 10:00 coffee is
    // not still advertised at 23:00 the same day.
    expect(src).toContain('eventEndsAt(a.event, tz).getTime() > Date.now()')
  })
})

describe('the people on it are shown the way every other strip shows them', () => {
  it('selects profileVisibility so the rule can be applied at all', () => {
    expect(src).toContain('user:  { select: { id: true, name: true, color: true, profilePhoto: true, profileVisibility: true } },')
  })

  it('passes the faces through restrictedSetFor', () => {
    expect(src).toContain('...whosGoingRaw.map(a => a.user),')
    expect(src).toContain("user: restricted.has(a.user.id)")
    expect(src).toContain('? { ...a.user, name: firstNameOf(a.user.name), profilePhoto: null }')
  })

  it('puts the same name in the alt as on the screen', () => {
    // alt={a.user.name} beside a firstNameOf label was the third instance of
    // this bug class in two days.
    expect(src).toContain('const shownName = firstNameOf(a.user.name)')
    expect(src).toContain('alt={shownName}')
    expect(src).not.toMatch(/alt=\{a\.user\.name\}/)
  })

  it('uses the shared initials helper, not a hand-rolled split', () => {
    // The hand-rolled version split an emoji's surrogate pair in half and
    // never upper-cased; the initials are now computed with getInitials in
    // the projection (see the disc test below).
    expect(src).toContain('getInitials(a.user.name),')
    expect(src).not.toContain("a.user.name.split(' ').map((w: string) => w[0])")
  })
})

describe('"familiar" means someone you were actually in a room with', () => {
  it('drops no-shows, stealth attendances, and anything older than a year', () => {
    expect(src).toContain("a.attendance !== 'no_show' && !a.stealth")
    expect(src).toContain('a.event.date >= familiarFloor')
    expect(src).toContain('const familiarFloor = shiftDay(today, -FAMILIAR_DAYS)')
    expect(src).toContain('.slice(0, FAMILIAR_CAP)')
  })

  it('applies the no-show rule to the other person too, not just the viewer', () => {
    // The viewer's own no-shows were excluded with the reasoning "they met
    // nobody" — which is just as true of someone who no-showed at the
    // viewer's event. 40 rows across 25 viewers qualified on that alone.
    expect(src).toContain("stealth: false, attendance: { not: 'no_show' } } }")
  })

  it('ignores past events that never happened', () => {
    // A postponed or draft event shared no room with anyone. 24 qualifying
    // rows sat behind postponed/draft events.
    expect(src).toContain("(a.event.status === 'published' || a.event.status === 'archived')")
  })

  it('caps by when the event was, not when the seat was booked', () => {
    // myAttendances is ordered joinedAt desc, so an unsorted slice would drop
    // an event attended last week in favour of one booked yesterday.
    expect(src).toContain('.sort((x, y) => (x.event.date < y.event.date ? 1 : -1))')
  })

  it('and a stealth attendance cannot make someone a familiar face either', () => {
    // The guard was on the upcoming row only; the match ignored it, and for a
    // member whose history is one event that resolves the event uniquely.
    expect(src).toContain("joinedEvents: { some: { eventId: { in: pastEventIds }, status: 'approved', stealth: false,")
  })

  it('still keeps the viewer, blocks and non-live accounts out', () => {
    expect(src).toContain('userId: { notIn: notMeOrBlocked },')
    expect(src).toContain('stealth: false,')
    expect(src).toContain('user: { ...LIVE,')
  })
})

describe('what it renders is stable and readable', () => {
  it('orders deterministically so a refresh does not reshuffle the faces', () => {
    expect(src).toContain("orderBy: [{ event: { date: 'asc' } }, { event: { time: 'asc' } }, { userId: 'asc' }],")
  })

  it('takes enough rows that one event cannot eat all eight slots', () => {
    // Rows are (person, event) pairs; dedupe is by person, so a tight window
    // let one roster fill every slot. The cap doesn't bind on today's data
    // (38 rows is the deepest); it is there so it can't start to.
    expect(src).toContain('take: 60,')
  })

  it('names the event once when every face is at the same one', () => {
    // 89 of the 112 members holding an upcoming RSVP hold exactly one, so the
    // per-face label was one string repeated under eight avatars — and
    // widening it to 92px made that worse, not better.
    expect(src).toContain('const goingEvent = new Set(whosGoing.map((a) => a.event.id)).size === 1 ? whosGoing[0].event : null')
    expect(src).toContain('? `Familiar faces at ${goingEvent.emoji} ${goingEvent.title}`')
    expect(src).toContain('{!goingEvent && (')
  })

  it('gives the event name room to be read when it does show one', () => {
    expect(src).not.toContain('max-w-[52px] line-clamp-2')
    expect(src).toContain('max-w-[92px] line-clamp-2')
  })

  it('keeps two initials on the disc without shipping the surname', () => {
    // getInitials(firstName) would have made every disc a single letter —
    // the only one-letter discs on the page. Computed server-side from the
    // full name instead, so only the two letters travel.
    expect(src).toContain('initials: restricted.has(a.user.id)')
    expect(src).toContain('? getInitials(firstNameOf(a.user.name))')
    expect(src).toContain(': getInitials(a.user.name),')
    expect(src).toContain('{a.initials}')
  })

  it('says what it now means', () => {
    expect(src).toContain("Familiar faces at the events you're going to")
  })
})
