import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  user:        { findMany: vi.fn() },
  memberBlock: { findMany: vi.fn().mockResolvedValue([]) },
} }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { extractMentions, mentionMatches, notifyMentions, MAX_MENTIONS, MAX_RECIPIENTS } from '@/lib/mentions'

// The wall's @mention resolver ran `name startsWith word` over the whole
// membership — no city, no cap, no block check — and neighborhood_mention is
// transactional, so "@a @e @m" pushed nearly every member through quiet
// hours. The composer inserts `@FirstName `, so that is what a mention is.

const p = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  p.memberBlock.findMany.mockResolvedValue([])
})

describe('extractMentions', () => {
  it('ignores single-character handles and dedupes', () => {
    expect(extractMentions('hi @a @e @Ali @ali @m')).toEqual(['ali'])
  })
  it('caps the number of handles per post', () => {
    const words = Array.from({ length: 12 }, (_, i) => `@name${i}`).join(' ')
    expect(extractMentions(words)).toHaveLength(MAX_MENTIONS)
  })
  it('reads Turkish letters as part of the name', () => {
    expect(extractMentions('@Şeyma @Gökçe')).toEqual(['şeyma', 'gökçe'])
  })
})

describe('mentionMatches', () => {
  it('matches the whole first name, case-insensitively', () => {
    expect(mentionMatches('Ali Yılmaz', 'ali')).toBe(true)
    expect(mentionMatches('ALI', 'ali')).toBe(true)
  })
  it('does not treat a mention as a prefix', () => {
    expect(mentionMatches('Alice Smith', 'ali')).toBe(false)
    expect(mentionMatches('Al', 'ali')).toBe(false)
  })
})

describe('notifyMentions', () => {
  const base = { authorId: 'me', authorName: 'Me', cityId: 'c1', link: '/neighborhoods/moda' }

  it('scopes the lookup to the post city and only notifies exact first-name matches', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Ali Y.' }, { id: 'u2', name: 'Alice' }])
    const n = await notifyMentions({ ...base, content: 'welcome @Ali' })
    expect(n).toBe(1)
    expect(p.user.findMany.mock.calls[0][0].where).toMatchObject({ cityId: 'c1', status: 'approved', id: { not: 'me' } })
    expect(createNotification).toHaveBeenCalledTimes(1)
    expect((createNotification as any).mock.calls[0][0]).toBe('u1')
  })

  it('does nothing when the content has no usable handle', async () => {
    const n = await notifyMentions({ ...base, content: '@a @e @m everyone!' })
    expect(n).toBe(0)
    expect(p.user.findMany).not.toHaveBeenCalled()
  })

  it('skips members on either side of a block', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Ali' }, { id: 'u2', name: 'Ali B.' }])
    p.memberBlock.findMany.mockResolvedValue([{ blockerId: 'u2', blockedId: 'me' }])
    const n = await notifyMentions({ ...base, content: '@ali' })
    expect(n).toBe(1)
    expect((createNotification as any).mock.calls[0][0]).toBe('u1')
  })

  it('caps recipients even when many share a first name', async () => {
    p.user.findMany.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, name: 'Ali' })))
    const n = await notifyMentions({ ...base, content: '@ali' })
    expect(n).toBe(MAX_RECIPIENTS)
    expect(createNotification).toHaveBeenCalledTimes(MAX_RECIPIENTS)
  })
})
