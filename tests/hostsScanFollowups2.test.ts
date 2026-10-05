import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Hosts scan 2026-09-28, items 7–15: a roster only for live cities; the
// cache is busted by every write that changes who may be listed; suspended
// hosts are not listed; a member's view drops blocked pairs and downgrades
// connections-only hosts outside their connections; guest keys are stable;
// both pages are one hub; the city section links by path; initials.

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }))
const blocked    = vi.fn(async () => new Set<string>())
const restricted = vi.fn(async () => new Set<string>())
vi.mock('@/lib/memberPrivacy', () => ({ blockedIdsFor: (...a: unknown[]) => blocked(...a), restrictedSetFor: (...a: unknown[]) => restricted(...a) }))

import { rosterForViewer } from '@/lib/hostRoster'
import type { RosterHost } from '@/lib/hostTitles'
import type { SessionUser } from '@/lib/session'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const roster     = read('lib/hostRoster.ts')
const cookiePage = read('app/hosts/page.tsx')
const cityPage   = read('app/[city]/hosts/page.tsx')
const hub        = read('components/HostsHub.tsx')
const section    = read('app/[city]/sections/Hosts.tsx')
const data       = read('app/[city]/data.ts')
const card       = read('components/HostRosterCard.tsx')

const host = (over: Partial<RosterHost>): RosterHost => ({
  id: 'u', name: 'Ayşe Yılmaz', color: '#000', profilePhoto: 'p.jpg', profileVisibility: 'everyone',
  title: 'host', clubs: [], upcomingCount: 0, hostedCount: 0, ...over,
})
const me = { id: 'me', role: 'member' } as unknown as SessionUser

beforeEach(() => { blocked.mockReset(); restricted.mockReset(); blocked.mockResolvedValue(new Set()); restricted.mockResolvedValue(new Set()) })

describe('a member\'s view of the roster (items 10–11)', () => {
  it('drops a blocked pair entirely', async () => {
    blocked.mockResolvedValue(new Set(['u2']))
    const out = await rosterForViewer([host({ id: 'u1' }), host({ id: 'u2' })], me)
    expect(out.map(h => h.id)).toEqual(['u1'])
  })
  it('downgrades a connections-only host outside my connections to the guest projection', async () => {
    restricted.mockResolvedValue(new Set(['u2']))
    const out = await rosterForViewer([host({ id: 'u1' }), host({ id: 'u2', name: 'Mehmet Kaya', profileVisibility: 'connections' })], me)
    expect(out[0]).toMatchObject({ id: 'u1', name: 'Ayşe Yılmaz', profilePhoto: 'p.jpg' })
    expect(out[1]).toMatchObject({ id: '', name: 'Mehmet', profilePhoto: null, title: 'host' })
    expect(restricted).toHaveBeenCalledWith(me, [
      { id: 'u1', profileVisibility: 'everyone' }, { id: 'u2', profileVisibility: 'connections' },
    ])
  })
  it('a guest gets the guest projection without any privacy reads', async () => {
    const out = await rosterForViewer([host({ id: 'u1' })], null)
    expect(out[0]).toMatchObject({ id: '', name: 'Ayşe', profilePhoto: null })
    expect(blocked).not.toHaveBeenCalled()
    expect(restricted).not.toHaveBeenCalled()
  })
  it('all three surfaces use it, and the section slices AFTER filtering', () => {
    expect(cookiePage).toContain('const hosts = await rosterForViewer(await getCityHostRoster(cityId, city.timezone), session)')
    expect(cityPage).toContain('const hosts = await rosterForViewer(await getCityHostRoster(city.id, city.timezone), session)')
    expect(data).toContain('const visible = await rosterForViewer(roster, session)')
    expect(data).toContain('return { hosts: visible.slice(0, CITY_PAGE_HOST_LIMIT), hostTotal: visible.length }')
    expect(read('app/[city]/page.tsx')).toContain('getCityHosts(city, session),')
  })
})

describe('suspended hosts are not listed (item 9)', () => {
  it('both roster arms use the same listable gate with the members-directory suspension clause', () => {
    expect(roster).toContain("OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],")
    expect(roster.split('user: listable').length - 1).toBe(2)
    expect(roster).toContain('profileVisibility: true')
  })
})

describe('the cache is busted by every write that changes the roster (item 8)', () => {
  it('bustHostRoster tolerates being called outside a request', () => {
    expect(roster).toContain('try { revalidateTag(HOST_ROSTER_TAG) } catch {')
  })
  it('demotion, ban/suspend/hide/move, club deactivation, stepping down, leaving and moving city all bust it', () => {
    const clubHosts = read('app/api/admin/clubs/[id]/hosts/route.ts')
    const del = clubHosts.slice(clubHosts.indexOf('export async function DELETE'))
    expect(del).toContain('revalidateTag(HOST_ROSTER_TAG)')
    expect(read('app/api/admin/users/[id]/route.ts')).toContain("if (['status', 'suspendedUntil', 'hiddenFromMembers', 'cityId', 'role'].some(k => k in allowed)) bustHostRoster()")
    expect(read('app/api/admin/clubs/[id]/route.ts')).toContain("if ('isActive' in allowed || 'cityId' in allowed) bustHostRoster()")
    const membership = read('app/api/clubs/[slug]/membership/route.ts')
    expect(membership).toContain("data:  { role: 'member' },\n    })\n    bustHostRoster()")
    expect(membership).toContain("if (membership.role === 'host') bustHostRoster()")
    expect(read('lib/cityMembership.ts')).toContain('  bustHostRoster()\n  return { ok: true, alreadyHome: false, city }')
  })
})

describe('only a live city has a roster page (item 7)', () => {
  it('the cookie page sends a non-live city to its city page, like the fixed page', () => {
    expect(cookiePage).toContain('if (!pub || pub.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)')
    expect(cityPage).toContain('if (city.status !== CITY_STATUS.Live) redirect(`/${city.slug}`)')
  })
})

describe('one hub, stable keys, path links, initials (items 12–15)', () => {
  it('both pages render HostsHub and nothing else', () => {
    expect(cookiePage).toContain('return <HostsHub city={city} hosts={hosts} signedIn={!!session} />')
    expect(cityPage).toContain('return <HostsHub city={city} hosts={hosts} signedIn={!!session} />')
    expect(hub).toContain('Meet the Hosts in <span className="text-amber-600">{city.name}</span>')
    expect(hub).toContain('Could you be a host?')
    expect(hub).toContain('<Link href={involved} className="btn-primary inline-flex">Become a host</Link>')
  })
  it('guest rows key by position', () => {
    expect(hub).toContain('key={h.id || `${h.name}-${i}`}')
    expect(section).toContain('key={h.id || `${h.name}-${i}`}')
  })
  it('the city section links by path, not by absolute URL', () => {
    expect(section).toContain("hubPath(city.slug, 'hosts')")
    expect(section).not.toContain('hubCanonical(')
    expect(data).toContain("return isDefaultCitySlug(slug) ? `/${kind}` : `/${slug}/${kind}`")
  })
  it('initials come from getInitials', () => {
    expect(card).toContain("{getInitials(h.name) || Array.from(h.name)[0] || ''}")
    expect(card).not.toContain('h.name.charAt(0)')
  })
})
