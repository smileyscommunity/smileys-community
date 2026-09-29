import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Dashboard scan 2026-09-29 (security + QA review), items 1–20.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page     = read('app/(member)/dashboard/page.tsx')
const timeline = read('components/ClubActivityTimeline.tsx')

describe('privacy', () => {
  // Nate 2026-09-29: open public clubs' galleries, then widen the strip.
  it('1: public clubs\' galleries are open to the city, and the strip links to them', () => {
    const api = read('app/api/clubs/[slug]/photos/route.ts')
    expect(api).toContain('const openToCity = !club.isPrivate && club.isActive &&')
    expect(api).toContain("where: { event: { clubId: club.id }, userId: { notIn: blockedIds } },")
    expect(api).toContain("author:    { id: '', name: p.event.title, color: '#d1d5db', photo: null },")
    expect(read('app/(member)/clubs/[slug]/ClubTabs.tsx')).toContain('canView={!isPrivate || isMember || isAdmin}')
    expect(page).toContain('{ event: { club: { isActive: true, isPrivate: false } } },')
    expect(page).toContain('title: p.event.title, user: null }')
    // Uploading stays members-only.
    expect(api).toContain("return NextResponse.json({ error: 'Join this club to upload photos' }, { status: 403 })")
  })
  it('2: a review follows the RSVP feed: listable reviewer, no stealth attendee, live event', () => {
    expect(page).toContain("user: LISTABLE, event: { cityId, status: { in: ['published', 'archived'] } } },")
    expect(page).toContain('.filter(r => !r.event.attendees.some(a => a.userId === r.userId))')
    const api = read('app/api/events/[id]/reviews/route.ts')
    expect(api).toContain("stealth.has(u.id)     ? { id: '', name: 'A guest', color: '#9ca3af' }")
    expect(api).toContain('restricted.has(u.id)  ? { ...u, name: firstNameOf(u.name) }')
    expect(api).toContain('userId: { notIn: blockedIds },')
  })
  it('3: suspended members are off every strip', () => {
    expect(page).toContain("AND: [{ OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }] }],")
    expect(page).toContain('visitAuthorOk(),')
    expect(page).toContain('!(u.suspendedUntil && u.suspendedUntil > new Date())')
  })
  it('4: testimonials use the public author rule and blocks', () => {
    expect(page).toContain('testimonialAuthorOk(), { OR: [{ userId: null }, { userId: { notIn: blockedIds } }] }] },')
  })
  it('5: /api/visitors drops a restricted author', () => {
    const api = read('app/api/visitors/route.ts')
    expect(api).toContain('await restrictedSetFor(session, announcements.flatMap(a => a.user ? [a.user] : []))')
    expect(api).toContain('user: authorOf(a.user) }')
  })
  it('6: /api/connections honours the neighbourhood switch', () => {
    expect(read('app/api/connections/route.ts')).toContain(': { ...rest, neighborhood: neighborhoodVisible ? rest.neighborhood : null }')
  })
  it('7: hangout rows check the hangout, its host and blocks', () => {
    // expired too: references are written after a hangout ends.
    expect(page).toContain("hangout:    { cityId, status: { in: ['active', 'expired'] }, userId: { notIn: blockedIds }, user: LIVE },")
    expect(page).toContain("hangout: { status: 'active', cityId, userId: { notIn: blockedIds }, user: LIVE } },")
  })
  it('8: a moderator is exempt only in their own city; hosts unchanged', () => {
    const lib = read('lib/memberPrivacy.ts')
    expect(lib).toContain("if (session.role === 'admin' || (await isClubHost(session.id))) return new Set()")
    expect(lib).toContain('cityId: session.cityId },')
  })
})

describe('right content, right city', () => {
  it('9: the city poll beats an everywhere-poll; the API is city-scoped', () => {
    expect(page).toContain("orderBy: [{ cityId: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],")
    const api = read('app/api/community-poll/route.ts')
    expect(api).toContain("where:   { active: true, OR: [{ cityId: null }, { cityId }] },")
    expect(api).toContain("This poll is for another city")
  })
  it('10: banners keep their city; the hero banner uses Link for internal links', () => {
    expect(read('app/api/admin/banners/route.ts')).toContain('...(citySlug ? { city: citySlug } : {}),')
    expect(page).toContain('<Link href={heroBanner.link}')
  })
  it('11: club picks need a real match before the size tiebreak', () => {
    const lib = read('lib/clubRecommendations.ts')
    expect(lib).toContain('.filter(x => x.match > 0)')
    expect(lib).toContain('score: x.match + Math.min((x.c.memberCount ?? 0) / 100, 2)')
  })
  it('12: the first event: open, not over, the viewed city, not on the shelves', () => {
    const lib = read('lib/firstEvent.ts')
    expect(lib).toContain('soldOut: false,')
    expect(lib).toContain('.filter(ev => eventEndsAt(ev, tz).getTime() > now)')
    expect(read('app/api/first-event/route.ts')).toContain('getFirstEventRecommendations(session.id, limit, { cityId, excludeIds })')
    // Only what the shelves RENDER — trending claims 20 and shows ≤ 4.
    expect(page).toContain('<FirstEventBlock excludeIds={shelfShownIds} />')
    expect(page).toContain('const shelfShownIds = [...pickedFeatured, ...pickedRecommended, ...pickedRunningLow, ...pickedNewThisWeek, ...trendingEvents].map(e => e.id)')
  })
  it('13: a no-clubs member sees this city\'s members\' club activity', () => {
    expect(page.split('user: clubIds.length ? LIVE : { ...LIVE, cityId },').length - 1).toBe(2)
  })
  it('14: each person in one people strip', () => {
    expect(page).toContain('const shownSuggested     = suggestedMembers.filter((m) => !newMemberIds.has(m.id))')
    expect(page).toContain('!suggestedMemberIds.has(m.id) && !newMemberIds.has(m.id)')
  })
  it('15: counts on the lists\' window; finished events counted when they end', () => {
    expect(page).toContain("const NOT_OVER = { OR: [{ date: { gt: today } }, { date: today, time: { gte: cutoffTime } }] }")
    expect(page).toContain("prisma.event.count({ where: { cityId, date: { lte: weekEndStr }, ...NOT_OVER, status: 'published' } }),")
    expect(page).toContain('eventEndsAt(a.event, a.event.city?.timezone ?? tz).getTime() <= nowMs)')
    expect(page).toContain("orderBy: [{ date: 'asc' }, { time: 'asc' }],")
  })
  it('16: links land where they say', () => {
    expect(page).toContain("href: '/clubs?tab=mine' },")
    expect(page).toContain('href={`/moving-sales/${s.id}`}')
    expect(read('components/PendingConnectionsWidget.tsx')).toContain('href={`/members/${c.requester.id}`}')
  })
  it('17: the home neighbourhood only on the home city', () => {
    expect(page).toContain('const myHood = cityId === session.cityId ? (userProfile?.neighborhood ?? null) : null')
    expect(page).toContain('href={`/neighborhoods/${neighborhoodToSlug(myHood)}?city=${city.slug}`}')
  })
})

describe('copy, speed, accessibility', () => {
  it('18: copy says what is there', () => {
    expect(read('components/OnboardingCard.tsx')).not.toContain('Visa, healthcare, banking')
    expect(read('components/PartnersBanner.tsx')).not.toContain('{firstNameOf(p.name)}')
    expect(page).toContain("attendance: { not: 'no_show' }, event: { date: { lt: today }")
    expect(page).toContain('<h2 className="text-xl font-bold text-gray-900">Stories</h2>')
    expect(page).toContain("{club.memberCount === 1 ? 'member' : 'members'}")
  })
  it('19: fewer serial round trips', () => {
    expect(page).toContain('const [cityMemberCount, upcomingRaw] = await Promise.all([')
    expect(page).toContain('const wantedTagIds = new Set((await wantedTagsP).map(r => r.tagId))')
    expect(page).not.toContain('prisma.communityPollVote.findUnique')
  })
  it('20: readable, labelled, hidden decoration', () => {
    expect(page).not.toContain('text-gray-400')
    expect(timeline).not.toContain('text-gray-400')
    expect(timeline).toContain('<span className="sr-only">{rating} out of 5 stars</span>')
    expect(read('components/PendingConnectionsWidget.tsx')).toContain("aria-label={`Accept ${c.requester.name}'s connection request`}")
    expect(read('components/GetStartedChecklist.tsx')).toContain('tabIndex={step.done ? -1 : undefined}')
  })
})

describe('regression review of e2442018', () => {
  it('the event\'s staff see every review as written; you always see your own', () => {
    const api = read('app/api/events/[id]/reviews/route.ts')
    expect(api).toContain('if (await canManageEventOps(session.id, session.role, eventId)) {')
    expect(api).toContain('{ userId: session.id },')
  })
  it('one "this week" number', () => {
    expect(page).toContain('<span className="text-sm font-extrabold text-amber-600">{thisWeekTotal}</span>')
  })
  it('moderators are scoped to their city in search and member routes too', () => {
    expect(read('lib/memberPrivacy.ts')).toContain('...(modCity ? [{ cityId: modCity, name: match }] : []),')
    expect(read('app/api/members/[id]/route.ts')).toContain('const privileged = canActInCity(session, user.cityId) || await isClubHost(session.id)')
    expect(read('app/api/members/route.ts')).toContain('session.cityId === await resolveCityId(session))')
  })
  it('an unknown banner city is dropped, not a blocked save', () => {
    const api = read('app/api/admin/banners/route.ts')
    expect(api).toContain("const citySlug = knownCities.has(rawCity) ? rawCity : ''")
    expect(api).not.toContain('unknown city')
  })
})
