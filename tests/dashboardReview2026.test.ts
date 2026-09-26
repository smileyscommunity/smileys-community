import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The member dashboard review (2026-09-19). The page showed galleries to
// people who couldn't open them, sent private clubs' invite links to the
// browser, listed connections-only and neighbourhood-hidden members to
// strangers, and pointed "Next event" at pages that 404'd. These pin the fixes.

const page = readFileSync(join(__dirname, '..', 'app/(member)/dashboard/page.tsx'), 'utf8')

describe('privacy', () => {
  // Widened 2026-09-24 to public clubs' photos, so members discover clubs
  // they haven't joined. What must hold: private clubs stay out, and a photo
  // from somewhere the viewer wasn't is credited to the event, not the
  // uploader (an uploader is an attendee, so naming them is a roster).
  it('photos come from galleries the viewer can open, and public clubs', () => {
    expect(page).toContain("{ event: { club: { isActive: true, isPrivate: false } } },")
    expect(page).toContain("OR: [{ clubId: { in: clubIds } }, { userId: session.id }, { club: { isPrivate: false } }],")
  })

  it('an outsider sees the event credited, not who uploaded', () => {
    expect(page).toContain("const inside = p.userId === session.id || joinedEventIds.includes(p.eventId) || p.event.hostId === session.id || p.event.cohosts.length > 0")
    expect(page).toContain("title: p.event.title, user: null }")
    expect(page).toContain("user: p.userId === session.id || clubIds.includes(p.clubId) ? p.user : null,")
  })

  it('the club lineup sends only the tile\'s fields to the browser', () => {
    expect(page).toContain("})).map(c => ({ id: c.id, slug: c.slug, name: c.name, emoji: c.emoji, bgColor: c.bgColor, category: c.category, memberCount: c.memberCount }))")
  })

  it('people listed are live, public or connected, and chose to be listed by neighbourhood', () => {
    // Activated community members only (2026-09-26): never-activated accounts and admin/partner logins were listed.
    expect(page).toContain("const LISTABLE = { ...LIVE, ...COMMUNITY_MEMBER_WHERE, OR: [{ profileVisibility: { not: 'connections' } }, { id: { in: connectedIds } }] }")
    expect(page).toContain("conditions.push({ neighborhood: userProfile.neighborhood, neighborhoodVisible: true })")
    expect(page).toContain("where: { neighborhood: userProfile.neighborhood, neighborhoodVisible: true, cityId, id: { notIn: notMeOrBlocked }, AND: [LISTABLE] }")
    // Suggestions skip people already connected.
    expect(page).toContain("id: { notIn: [...notMeOrBlocked, ...connectedIds] }")
  })

  it('who a private or hidden member connects with isn\'t announced', () => {
    expect(page).toContain("requester: { cityId, ...LIVE, profileVisibility: { not: 'connections' } }")
  })

  it('the visitors strip and spotlight follow connections-only privacy', () => {
    expect(page).toContain('const restricted = await restrictedSetFor(session, [')
    expect(page).toContain('user:     v.user && !restricted.has(v.user.id)')
    expect(page).toContain("u.cityId === cityId && !blockedIds.includes(u.id)")
  })
})

describe('what the page says', () => {
  it('"Next event" and the upcoming count are published events that haven\'t ended', () => {
    expect(page).toContain("event: { date: { gte: today }, status: 'published', cancelledAt: null }")
    expect(page).toContain('upcomingRaw.filter(a => eventEndsAt(a.event, tz).getTime() > Date.now())')
  })

  it('pending requests are for events still to come', () => {
    expect(page).toContain("where: { userId: session.id, status: 'pending', event: { date: { gte: today }, status: 'published', cancelledAt: null } }")
  })

  it('no streak or profile-view tiles; counts are events actually gone to', () => {
    expect(page).not.toContain("'Month streak'")
    expect(page).not.toContain("'Profile views'")
    expect(page).toContain("a.attendance !== 'no_show'")
  })

  it('a sponsored banner shows in the city it was written for', () => {
    expect(page).toContain("adBanners = adBanners.filter((b) => (typeof b.city === 'string' && b.city ? b.city : DEFAULT_CITY_SLUG) === city.slug)")
  })

  it('trending is ranked by people going, not every attendee row', () => {
    expect(page).toContain('.sort((a, b) => b._count.attendees - a._count.attendees')
  })

  it('listings link to the marketplace, not the conversation board', () => {
    expect(page).not.toContain('/board?id=')
    expect(page).not.toContain('/board?tab=MOVING')
  })
})

// Dashboard bug batch (2026-09-26).
describe('discovery shelves offer only what a member can still join', () => {
  it('drops ended, full and already-requested events before the claims', () => {
    expect(page).toContain("notEnded(e) && !e.soldOut && !(e.limitedSpots && e.spotsLeft <= 0) && !pendingIds.has(e.id)")
    for (const shelf of ['featuredEvents', 'deduplicatedRecommended', 'runningLow', 'newThisWeek', 'trendingRanked']) {
      expect(page).toContain(`claimEvents(${shelf}.filter(joinable))`)
    }
  })

  it('browse surfaces keep full events but not finished ones', () => {
    expect(page).toContain('const thisWeekShown = thisWeekEvents.filter(notEnded)')
    expect(page).toContain('events={clubEventsShown} photos=')
  })

  it('pending requests are not capped at 10', () => {
    expect(page).not.toContain("orderBy: { joinedAt: 'desc' }, take: 10,")
  })

  it('new members are activated community members', () => {
    expect(page).toContain("where: { ...COMMUNITY_MEMBER_WHERE, cityId, hiddenFromMembers: false, profileVisibility: { not: 'connections' }, joinedAt: { gte: weekAgo }")
  })

  it('listings past their expiry are not shown', () => {
    expect(page).toContain("where: { status: 'active', cityId, expiresAt: { gte: new Date() },")
  })
})
