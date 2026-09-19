import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The member dashboard review (2026-09-19). The page showed galleries to
// people who couldn't open them, sent private clubs' invite links to the
// browser, listed connections-only and neighbourhood-hidden members to
// strangers, and pointed "Next event" at pages that 404'd. These pin the fixes.

const page = readFileSync(join(__dirname, '..', 'app/(member)/dashboard/page.tsx'), 'utf8')

describe('privacy', () => {
  it('photos come only from galleries the viewer can open', () => {
    expect(page).toContain("event: { cityId, OR: [{ id: { in: joinedEventIds } }, { hostId: session.id }, { cohosts: { some: { userId: session.id } } }] }")
    expect(page).toContain("where: { clubId: { in: clubIds }, club: { isActive: true, OR: [{ cityId }, { cityId: null }] }, userId: { notIn: blockedIds }, user: LIVE }")
  })

  it('the club lineup sends only the tile\'s fields to the browser', () => {
    expect(page).toContain("})).map(c => ({ id: c.id, slug: c.slug, name: c.name, emoji: c.emoji, bgColor: c.bgColor, category: c.category, memberCount: c.memberCount }))")
  })

  it('people listed are live, public or connected, and chose to be listed by neighbourhood', () => {
    expect(page).toContain("const LISTABLE = { ...LIVE, OR: [{ profileVisibility: { not: 'connections' } }, { id: { in: connectedIds } }] }")
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
