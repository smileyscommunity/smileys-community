import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fold } from '@/lib/turkishFold'

// The members directory review (2026-09-20), server side — the page's own
// half is pinned in membersDirectoryReview2026. Sending someone a request
// read back the full name and photo their locked card hides;
// block-then-unblock erased a permanent decline and the abuse scan's
// evidence; discovery listed members by the neighbourhood they had asked not
// to be listed by; and the search box promised interests and clubs it never
// searched.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('a pending request', () => {
  it("doesn't read back what the locked card withholds", () => {
    const route = src('app/api/connections/route.ts')
    expect(route).toContain('? { ...rest, name: firstNameOf(p.name), profilePhoto: null, neighborhood: null }')
  })
})

describe('blocking', () => {
  const route = src('app/api/members/block/route.ts')

  it('keeps the decline that makes a refusal permanent', () => {
    // Severs pending and accepted; a declined row IS the decline, and the
    // abuse scan counts it.
    expect(route).toContain("status: { in: ['pending', 'accepted'] },")
  })

  it("drops the pair's saves, and unblocking is bounded", () => {
    expect(route).toContain('prisma.memberSave.deleteMany({')
    expect(route).toContain('rateLimit(`unblock:${session.id}`, 20, 60 * 60_000)')
  })

  it('saving someone requires a member you could actually open', () => {
    const saved = src('app/api/members/saved/route.ts')
    expect(saved).toContain('if (await isBlockedEitherWay(session.id, memberId)) {')
    expect(saved).toContain('|| target.hiddenFromMembers')
  })
})

describe('discovery', () => {
  const route = src('app/api/members/discovery/route.ts')

  it('respects the neighbourhood opt-out, in the card and in the pool', () => {
    expect(route).toContain('neighborhood: m.neighborhoodVisible ? m.neighborhood : null,')
    // The pool gathers people BY neighbourhood, which turned the opt-out
    // into a listing of exactly the people who opted out.
    expect(route).toContain('neighborhood: viewer.neighborhood, neighborhoodVisible: true },')
  })

  it('leaves out suspended members, and has a budget', () => {
    // "null OR past", never a NOT: `NOT (suspendedUntil > now)` is NULL for
    // everyone who has never been suspended, and a NULL predicate drops the
    // row — that spelling emptied every discovery pool.
    expect(route).toContain('AND: [{ OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }] }],')
    // …and a pool that adds its own AND merges with it.
    expect(route).toContain('AND: [...visibleWhere.AND, {')
    expect(route).toContain('rateLimit(`member-discovery:${session.id}`, 30, 60_000)')
  })
})

describe('the list', () => {
  const route = src('app/api/members/route.ts')

  it('gives a locked card nothing the locked profile withholds', () => {
    expect(route).toContain('profilePhoto: null, joinedAt: null,')
    expect(route).toContain('role: null, instagram: null, linkedin: null, lastActive: null,')
    expect(route).toContain('membershipType: null, foundingMember: false,')
  })

  it("matches the profile route for a member who isn't connected", () => {
    // Clubs they merely belong to are a connection's to know; what they're
    // looking for is a discovery signal, like interests — and the filter
    // would confirm it one request at a time whatever the card said.
    expect(route).toContain("cm.role === 'host' && !cm.club.isPrivate")
    expect(route).toContain('lookingFor: m.lookingFor,')
  })

  it('the host and admin pills are not an oracle on a locked member', () => {
    expect(route).toContain('|| isHost || adminOnly)')
  })

  it('every count is the count of what that pill would show', () => {
    expect(route).toContain('const visibleBase: Prisma.UserWhereInput = {')
    expect(route).toContain('savedByMembers: { some: { userId: session.id } }')
  })

  it('sorts and pages on the server, with a stable tiebreaker', () => {
    expect(route).toContain('orderBy: SORTS[sort],')
    expect(route).toContain("joined: [{ joinedAt: 'desc' as const }, { id: 'desc' as const }],")
  })

  it('can fetch one member back by id, for the row an accept just unlocked', () => {
    expect(route).toContain("const ids = req.nextUrl.searchParams.get('ids')")
  })
})

describe('searching', () => {
  it('folds the Turkish letters that made names unfindable', () => {
    // 'İpek'.toLowerCase() is i + a combining dot, so a plain contains never
    // matched what anyone types.
    expect(fold('İpek')).toBe('ipek')
    expect(fold('Işık')).toBe('isik')
    expect(fold('  Şule  ')).toBe('sule')
    expect(fold('José')).toBe('jose')
  })

  it('looks at interests and club names, publicly-visible members only', () => {
    const lib = src('lib/memberSearch.ts')
    expect(lib).toContain('FROM unnest(u.interests) AS i')
    expect(lib).toContain('lower(translate(c.name,')
    expect(lib).toContain('u."profileVisibility" <> \'connections\'')
    expect(src('app/api/members/route.ts')).toContain('const searchIds = search ? await searchableMemberIds(search, await resolveCityId(session)) : []')
  })
})
