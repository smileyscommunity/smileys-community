import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Follow-ups from the 2026-09-14 production dry runs of the 101–110 scripts:
//  · repair-dead-notification-links would have nulled 1,198 new_article links
//    to a `-1` duplicate post slug whose original is live
//  · 46 memberships in inactive clubs still showed on the dashboard (club page
//    404s), and hosts of inactive clubs kept isClubHost privileges

const h = vi.hoisted(() => ({
  prisma: { clubMembership: { count: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))

import { classifyLink, referencedKeys, originalPostSlug, type ExistenceIndex } from '@/scripts/repair-dead-notification-links'
import { isClubHost } from '@/lib/access'

const read = (p: string) => readFileSync(p, 'utf-8')

const index = (postSlugs: string[]): ExistenceIndex => ({
  keys: { 'post.slug': new Set(postSlugs) },
  clubSlugById: new Map(),
})

describe('dead links: a removed `-1` duplicate post points at its live original', () => {
  const dup  = 'scams-tourist-traps-in-t-rkiye-how-to-stay-safe-without-becoming-paranoid-1'
  const orig = 'scams-tourist-traps-in-t-rkiye-how-to-stay-safe-without-becoming-paranoid'

  it('originalPostSlug strips a short numeric suffix only', () => {
    expect(originalPostSlug(dup)).toBe(orig)
    expect(originalPostSlug('guide-2')).toBe('guide')
    expect(originalPostSlug('plain-slug')).toBeNull()
    expect(originalPostSlug('2026')).toBeNull()
  })

  it('referencedKeys asks for the original too, so the index can know it exists', () => {
    const keys = referencedKeys([`/handbook/${dup}`, `/posts/${dup}`])
    expect([...keys.get('post.slug')!]).toEqual(expect.arrayContaining([dup, orig]))
  })

  it.each(['/handbook', '/posts'])('%s/<dup> is REWRITABLE to the original when it is live', base => {
    const v = classifyLink(`${base}/${dup}`, index([orig]))
    expect(v.status).toBe('REWRITABLE')
    expect(v.newLink).toBe(`${base}/${orig}`)
    expect(v.reason).toContain('duplicate slug → original')
  })

  it('stays DEAD when the original is gone as well', () => {
    const v = classifyLink(`/handbook/${dup}`, index([]))
    expect(v.status).toBe('DEAD')
    expect(v.newLink).toBeNull()
  })

  it('a live `-1` slug is left LIVE, never rewritten', () => {
    expect(classifyLink(`/handbook/${dup}`, index([dup, orig])).status).toBe('LIVE')
  })
})

describe('inactive clubs grant nothing', () => {
  beforeEach(() => { h.prisma.clubMembership.count.mockReset() })

  it('isClubHost counts only approved host rows in active clubs', async () => {
    h.prisma.clubMembership.count.mockResolvedValueOnce(0)
    await expect(isClubHost('u1')).resolves.toBe(false)
    expect(h.prisma.clubMembership.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'u1', role: 'host', club: { isActive: true } }),
    })
  })

  it('the dashboard lists only the member\'s active clubs', () => {
    expect(read('app/(member)/dashboard/page.tsx'))
      .toMatch(/where: \{ userId: session\.id, status: 'approved', club: \{ isActive: true \} \}/)
  })
})
