import { describe, it, expect, vi, beforeEach } from 'vitest'

// An event typed with a venue name the directory already lists must link to
// that listing, not make a new pending stub. Four duplicate pairs had to be
// merged by hand on 2026-09-28 because this matched names with Postgres'
// case-insensitive compare, which lowercases "DOZZE KADIKÖY" to
// "dozze kadiköy" — never equal to "Dozze Kadıköy" (dotless ı) — and knew
// nothing of hosts' short names ("Spice Corner", "Blak Yeldeğirmeni").

vi.mock('@/lib/prisma', () => ({
  prisma: { business: { findMany: vi.fn(), create: vi.fn(async () => ({ id: 'new_stub' })) } },
}))

import { prisma } from '@/lib/prisma'
import { ensurePendingVenueBusiness, matchVenue, VENUE_ALIASES } from '@/lib/venueDirectory'
import { foldPlaceName } from '@/lib/neighborhoods'

const ROWS = [
  { id: 'dozze_live',   name: 'Dozze Kadıköy',                 isApproved: true,  isActive: true },
  { id: 'dozze_dupe',   name: 'DOZZE KADIKÖY',                 isApproved: false, isActive: false },
  { id: 'spice_live',   name: 'Spice Corner Indian Restaurant', isApproved: true,  isActive: true },
  { id: 'blak_live',    name: 'BLAK Coffee Co. Yeldeğirmeni',   isApproved: true,  isActive: true },
  { id: 'karyatid',     name: 'Karyatid Sahne',                 isApproved: false, isActive: true },
  { id: 'moda_hidden',  name: 'Moda Sahil',                     isApproved: false, isActive: false },
  { id: 'archeo',       name: 'Archeo Cafe and Hostel',         isApproved: true,  isActive: true },
]

const findMany = vi.mocked(prisma.business.findMany)
const create   = vi.mocked(prisma.business.create)

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue(ROWS as never)
})

describe('matchVenue', () => {
  it('folds case and Turkish letters, and prefers the live listing over a hidden duplicate', () => {
    expect(matchVenue('DOZZE KADIKÖY', ROWS)?.id).toBe('dozze_live')
    expect(matchVenue('dozze kadikoy', ROWS)?.id).toBe('dozze_live')
  })
  it('resolves hosts\' alternate names', () => {
    expect(matchVenue('Spice Corner', ROWS)?.id).toBe('spice_live')
    expect(matchVenue('Blak Yeldeğirmeni', ROWS)?.id).toBe('blak_live')
    expect(matchVenue('Karyadit Sahne', ROWS)?.id).toBe('karyatid')
    expect(matchVenue('Dozze', ROWS)?.id).toBe('dozze_live')
    expect(matchVenue('Arch Cafe', ROWS)?.id).toBe('archeo')
  })
  it('still matches a hidden row when it is the only one — a hidden non-venue is not re-created', () => {
    expect(matchVenue('Moda Sahil', ROWS)?.id).toBe('moda_hidden')
  })
  it('matches nothing for an unknown venue', () => {
    expect(matchVenue('Some New Cafe', ROWS)).toBeNull()
    expect(matchVenue('   ', ROWS)).toBeNull()
  })
  it('every alias points at a folded name, not at itself', () => {
    for (const [from, to] of Object.entries(VENUE_ALIASES)) {
      expect(foldPlaceName(from)).toBe(from)
      expect(foldPlaceName(to)).toBe(to)
      expect(to).not.toBe(from)
    }
  })
})

describe('ensurePendingVenueBusiness', () => {
  it('links the existing listing instead of making a stub', async () => {
    expect(await ensurePendingVenueBusiness({ location: 'DOZZE KADIKÖY', cityId: 'c1' })).toBe('dozze_live')
    expect(await ensurePendingVenueBusiness({ location: 'Spice  Corner ', cityId: 'c1' })).toBe('spice_live')
    expect(create).not.toHaveBeenCalled()
    expect(findMany.mock.calls[0][0]?.where).toEqual({ cityId: 'c1' })
  })
  it('makes a pending stub for a genuinely new venue', async () => {
    expect(await ensurePendingVenueBusiness({ location: 'Some New Cafe', cityId: 'c1' })).toBe('new_stub')
    const data = create.mock.calls[0][0].data
    expect(data).toMatchObject({ name: 'Some New Cafe', cityId: 'c1', isApproved: false, isActive: true, category: 'Cafe' })
  })
  it('never throws — a lookup failure must not break event creation', async () => {
    findMany.mockRejectedValueOnce(new Error('db down'))
    expect(await ensurePendingVenueBusiness({ location: 'Anything', cityId: 'c1' })).toBeNull()
  })
})
