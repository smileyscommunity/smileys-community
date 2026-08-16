import { describe, it, expect, vi, beforeEach } from 'vitest'

// A testimonial belongs to a city, or explicitly to none. The input that
// decides this comes from an admin form, and the failure mode is quiet: an id
// that doesn't resolve must not become "shows in every city", which is how
// Istanbul members' quotes ended up on Izmir's and Bodrum's pages.

vi.mock('@/lib/prisma', () => ({ prisma: { city: { findUnique: vi.fn() } } }))

import { prisma } from '@/lib/prisma'
import { INVALID, resolveCityIdInput } from '@/app/api/admin/testimonials/cityInput'

beforeEach(() => vi.clearAllMocks())

describe('resolveCityIdInput', () => {
  it('accepts a real city', async () => {
    ;(prisma.city.findUnique as any).mockResolvedValue({ id: 'c-izmir' })
    expect(await resolveCityIdInput('c-izmir')).toBe('c-izmir')
  })

  it('rejects an unknown city rather than treating it as across-Smileys', async () => {
    // The whole point. A stale or typo'd id silently becoming null would
    // publish one city's quote to all of them — the original bug, restored
    // through the back door.
    ;(prisma.city.findUnique as any).mockResolvedValue(null)
    expect(await resolveCityIdInput('c-deleted')).toBe(INVALID)
  })

  it.each([
    ['an omitted field', undefined],
    ['an explicit null',  null],
    ['the empty-string option the form submits', ''],
    ['whitespace',        '   '],
  ])('reads %s as across-Smileys', async (_label, input) => {
    expect(await resolveCityIdInput(input)).toBeNull()
    // No lookup for the no-city cases — nothing to verify.
    expect(prisma.city.findUnique).not.toHaveBeenCalled()
  })
})
