import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Neighborhoods scan 2026-09-28, items 1–6 (privacy). Source pins: each rule
// is a where-clause or a projection in a server component, and the shape of
// the clause is the guarantee.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const sections = read('app/neighborhoods/[slug]/NeighborhoodSections.tsx')
const index    = read('app/neighborhoods/page.tsx')
const hero     = read('app/neighborhoods/[slug]/HeroStats.tsx')

describe('event photos follow the event page rule (item 1)', () => {
  it('a guest gets no photos; a member only their own events; staff everything', () => {
    const block = sections.slice(sections.indexOf('prisma.eventPhoto.findMany'), sections.indexOf("myId ? prisma.neighborhoodPost.count"))
    expect(sections).toContain("myId\n      ? prisma.eventPhoto.findMany")
    expect(block).toContain("...(isStaff ? {} : { OR: [")
    expect(block).toContain('{ hostId: myId }')
    expect(block).toContain("{ cohosts:   { some: { userId: myId } } }")
    expect(block).toContain("{ attendees: { some: { userId: myId, status: 'approved' } } }")
    expect(sections).toContain(": Promise.resolve([]),\n    myId ? prisma.neighborhoodPost.count")
  })
})

describe('index strips respect connections-only profiles (items 2–3)', () => {
  it('"Your neighborhood" projects restricted neighbours to a first name and no photo', () => {
    expect(index).toContain('const restrictedYours = await restrictedSetFor(session, rows)')
    expect(index).toContain("? { id: m.id, name: firstNameOf(m.name) || 'Smileys member', color: m.color, profilePhoto: null }")
    // The privacy column has to be selected for restrictedSetFor to see it.
    const q = index.slice(index.indexOf('const rows = await prisma.user.findMany'), index.indexOf('const restrictedYours'))
    expect(q).toContain('profileVisibility: true')
  })
  it('visitor cards project a restricted author before the name reaches the say-hi button', () => {
    expect(index).toContain('const restricted = await restrictedSetFor(session, rows.flatMap(r => r.user ? [r.user] : []))')
    expect(index).toContain("? { id: r.user.id, name: firstNameOf(r.user.name) || 'Smileys member', color: r.user.color, profilePhoto: null }")
  })
})

describe('guests see no visitor sections on neighbourhood pages (item 4)', () => {
  it('both pages gate the visitor query on a session', () => {
    expect(index).toContain('const visitorsNearby = session && focusNeighborhood')
    expect(index).not.toContain("visibility: 'public'")
    expect(sections).toContain('!myId ? Promise.resolve([]) : (async () => {')
    expect(sections).not.toContain("...(myId ? {} : { visibility: 'public' })")
    expect(sections).not.toContain('guestView(')
    expect(index).not.toContain('guestView(')
  })
})

describe('wall replies and reactions carry the post gates (item 5)', () => {
  for (const p of ['app/api/neighborhoods/[slug]/posts/[postId]/replies/route.ts', 'app/api/neighborhoods/[slug]/posts/[postId]/like/route.ts']) {
    it(`${p.split('/').slice(-2, -1)[0]}: own-city write and no blocked pair`, () => {
      const src = read(p)
      expect(src).toContain('if (post.cityId !== await resolvePostingCityId(session)) {')
      expect(src).toContain("if (await isBlockedEitherWay(session.id, post.userId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })")
      expect(src).toContain('userId: true }')
    })
  }
  it('the reply mention link names the post city', () => {
    const src = read('app/api/neighborhoods/[slug]/posts/[postId]/replies/route.ts')
    expect(src).toContain("const link = `/neighborhoods/${slug}${wallCity.slug === DEFAULT_CITY_SLUG ? '' : `?city=${wallCity.slug}`}`")
    expect(src).not.toContain('link: `/neighborhoods/${slug}` }')
  })
})

describe('a guest\'s "Local members (N)" counts the people the strip shows (item 6)', () => {
  it('hero and sections exclude connections-only members from a guest count', () => {
    expect(hero).toContain("...(userId ? {} : { profileVisibility: { not: 'connections' } }),")
    expect(sections).toContain("...(viewer ? {} : { profileVisibility: { not: 'connections' } }),")
  })
})
