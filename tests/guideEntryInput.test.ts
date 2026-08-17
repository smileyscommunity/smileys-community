import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { neighborhood: { findMany: vi.fn() } } }))
vi.mock('@/lib/city', () => ({
  getCityConfig:     vi.fn(async () => ({ slug: 'bodrum' })),
  DEFAULT_CITY_SLUG: 'istanbul',
}))

import { prisma } from '@/lib/prisma'
import { validateGuideEntry, guideEntryPayload } from '@/lib/guideEntryInput'

// The admin form offers the right options, but a form is not a boundary. These
// pin the server-side rules: per-city taxonomy, per-city neighborhoods, and the
// one editorial rule that matters — an entry cannot go live without a Smileys
// Take, which is the whole difference between this and scraped tourist copy.

let n = 0
const city = () => ({ cityId: `c-bodrum-${n++}`, citySlug: 'bodrum' })

const valid = {
  title: 'Take a boat into the bays',
  slug: 'boat-into-the-bays',
  tagline: 'See Bodrum from the sea.',
  collection: 'boat',
  moods: ['boat', 'summer'],
  seasons: ['summer'],
  neighborhoods: ['Gümüşlük'],
  why: 'The coastline disappears behind you.',
  take: 'Get on a boat at least once.',
  status: 'published',
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(prisma.neighborhood.findMany as any).mockResolvedValue([{ name: 'Gümüşlük' }, { name: 'Bitez' }])
})

describe('validateGuideEntry', () => {
  it('accepts a complete entry', async () => {
    const r = await validateGuideEntry(valid, city())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.status).toBe('published')
  })

  it('refuses to publish without The Smileys Take', async () => {
    const r = await validateGuideEntry({ ...valid, take: '   ' }, city())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Smileys Take/i)
  })

  it('lets a draft be as empty as you like', async () => {
    // Half-written entries are the normal state of editorial work; only
    // publishing is the commitment.
    const r = await validateGuideEntry({ title: 'Rough idea', slug: 'rough-idea', tagline: 'tbc', collection: 'boat', status: 'draft' }, city())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.take).toBe('')
  })

  it('refuses to publish without a why', async () => {
    const r = await validateGuideEntry({ ...valid, why: '' }, city())
    expect(r.ok).toBe(false)
  })

  it("rejects another city's collection and moods", async () => {
    // 'bosphorus' is Istanbul's vocabulary — on a Bodrum entry it would render
    // into no shelf at all, which reads as the entry vanishing.
    expect((await validateGuideEntry({ ...valid, collection: 'bosphorus' }, city())).ok).toBe(false)
    expect((await validateGuideEntry({ ...valid, moods: ['bosphorus'] }, city())).ok).toBe(false)
  })

  it("rejects a neighborhood the city doesn't have", async () => {
    const r = await validateGuideEntry({ ...valid, neighborhoods: ['Kadıköy'] }, city())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not a neighborhood/i)
  })

  it('rejects an invalid season', async () => {
    expect((await validateGuideEntry({ ...valid, seasons: ['monsoon'] }, city())).ok).toBe(false)
  })

  it('requires a title, slug and tagline', async () => {
    for (const missing of ['title', 'slug', 'tagline']) {
      const r = await validateGuideEntry({ ...valid, [missing]: '' }, city())
      expect(r.ok, missing).toBe(false)
    }
  })

  it('enforces a url-safe slug', async () => {
    for (const bad of ['Boat Bays', 'boat--bays', '-boat', 'boat-', 'boat_bays', 'Gümüşlük']) {
      expect((await validateGuideEntry({ ...valid, slug: bad }, city())).ok, bad).toBe(false)
    }
    expect((await validateGuideEntry({ ...valid, slug: 'boat-into-bays-2' }, city())).ok).toBe(true)
  })

  it('drops a section with no items — it would render as a bare heading', async () => {
    const r = await validateGuideEntry({
      ...valid,
      sections: [{ title: 'Good to know', items: ['Bring water', ''] }, { title: 'Empty', items: [] }, { title: '', items: ['orphan'] }],
    }, city())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.sections).toEqual([{ title: 'Good to know', items: ['Bring water'] }])
    }
  })

  it('defaults an unknown status to draft rather than publishing it', async () => {
    const r = await validateGuideEntry({ ...valid, status: 'live' }, city())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.status).toBe('draft')
  })

  it('trims and lowercases the slug, and defaults the emoji', async () => {
    const r = await validateGuideEntry({ ...valid, slug: '  BOAT-INTO-BAYS ', emoji: '' }, city())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.slug).toBe('boat-into-bays')
      expect(r.value.emoji).toBe('✨')
    }
  })
})

describe('guideEntryPayload', () => {
  it('puts the long-form fields in content and empty meta as null', async () => {
    const r = await validateGuideEntry({ ...valid, cost: '', time: 'Half a day' }, city())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p = guideEntryPayload(r.value)
    expect(p.content).toEqual({ why: valid.why, take: valid.take, sections: [] })
    // Empty strings would render as blank chips; null renders nothing.
    expect(p.cost).toBeNull()
    expect(p.time).toBe('Half a day')
    expect(p.seasons).toEqual(['summer'])
  })
})
