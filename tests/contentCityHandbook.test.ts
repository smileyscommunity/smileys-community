import { describe, it, expect, vi, beforeEach } from 'vitest'

// The footer's city for a handbook article comes from the article's row. A
// city-local article (Başkentkart, BursaKart) dresses the page in its own
// city; a global one has no cityId and must resolve to null so the layout
// falls back to the reader's city, exactly as the page title already does.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    post:         { findFirst: vi.fn() },
    guideEntry:   { findFirst: vi.fn() },
    neighborhood: { findFirst: vi.fn() },
  },
}))

import { cityIdForContent } from '@/lib/contentCity'
import { prisma } from '@/lib/prisma'

const findFirst = prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>

describe('cityIdForContent — handbook', () => {
  beforeEach(() => findFirst.mockReset())

  it('answers the article\'s own city for a city-local article', async () => {
    findFirst.mockResolvedValueOnce({ cityId: 'c-ankara' })
    await expect(cityIdForContent({ kind: 'handbook', slug: 'baskentkart' })).resolves.toBe('c-ankara')
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: 'baskentkart', kind: 'handbook', status: 'published' },
    }))
  })

  it('answers null for a global article, so the footer keeps the reader\'s city', async () => {
    findFirst.mockResolvedValueOnce({ cityId: null })
    await expect(cityIdForContent({ kind: 'handbook', slug: 'residence-permit' })).resolves.toBeNull()
  })

  it('answers null for a slug that matches no published handbook post', async () => {
    findFirst.mockResolvedValueOnce(null)
    await expect(cityIdForContent({ kind: 'handbook', slug: 'still-a-draft' })).resolves.toBeNull()
  })

  it('survives a database error — a layout must render', async () => {
    findFirst.mockRejectedValueOnce(new Error('down'))
    await expect(cityIdForContent({ kind: 'handbook', slug: 'db-down' })).resolves.toBeNull()
  })
})
