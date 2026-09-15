import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {
  $queryRaw:   vi.fn(),
  memberBlock: { findMany: vi.fn().mockResolvedValue([]) },
} }))
vi.mock('@/lib/notify', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))

import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { extractMentions, mentionMatches, notifyMentions, foldName, MAX_MENTIONS, MAX_RECIPIENTS } from '@/lib/mentions'
import { parseMentionSql } from './helpers/mentionSql'

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
  it('ignores single-character handles and dedupes case-insensitively, keeping the first spelling', () => {
    // Dedupe is by foldName, never bare JS lowercasing: that produced 'i̇rem'
    // (combining dot) for İrem, which no query ever matched — İrem, İpek and
    // İsmail were never notified.
    expect(extractMentions('hi @a @e @Ali @ali @m')).toEqual(['Ali'])
  })
  it('keeps hyphens and apostrophes inside a name', () => {
    // The composer inserts the whole first name; a token that stopped at the
    // hyphen turned "@Jean-Luc" into "jean", which never equalled "jean-luc".
    expect(extractMentions("@Jean-Luc and @O'Brien and @D’Arcy")).toEqual(['Jean-Luc', "O'Brien", 'D’Arcy'])
  })
  it('caps the number of handles per post', () => {
    const words = Array.from({ length: 12 }, (_, i) => `@name${i}`).join(' ')
    expect(extractMentions(words)).toHaveLength(MAX_MENTIONS)
  })
  it('reads Turkish letters as part of the name', () => {
    expect(extractMentions('@Şeyma @Gökçe @İrem')).toEqual(['Şeyma', 'Gökçe', 'İrem'])
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
  it('matches hyphenated, apostrophe and İ-initial first names however they were typed', () => {
    expect(mentionMatches('Jean-Luc Picard', 'Jean-Luc')).toBe(true)
    expect(mentionMatches('Jean-Luc Picard', 'jean-luc')).toBe(true)
    expect(mentionMatches("O'Brien Kelly", 'O’Brien')).toBe(true)
    expect(mentionMatches('İrem Yılmaz', 'İrem')).toBe(true)
    expect(mentionMatches('İrem Yılmaz', 'irem')).toBe(true)
    expect(foldName('İREM')).toBe(foldName('irem'))
  })
})

describe('notifyMentions', () => {
  const base = { authorId: 'me', authorName: 'Me', cityId: 'c1', link: '/neighborhoods/moda' }

  it('scopes the lookup to the post city and only notifies exact first-name matches', async () => {
    p.$queryRaw.mockResolvedValue([{ id: 'u1', name: 'Ali Y.' }, { id: 'u2', name: 'Alice' }])
    const n = await notifyMentions({ ...base, content: 'welcome @Ali' })
    expect(n).toBe(1)
    const q = parseMentionSql(p.$queryRaw.mock.calls[0][0])
    expect(q).toMatchObject({ cityId: 'c1', authorId: 'me', limit: 50 })
    expect(q.text).toContain(`status = 'approved'`)
    expect(q.text).toContain(`"hiddenFromMembers" = false`)
    // The token is asked for as a whole word against the folded name (a bare
    // prefix capped at 50 let Alices crowd out Ali). The DB has no unaccent,
    // so the query folds the stored name itself (scan 6 batch 26).
    expect(q.folded).toEqual(['ali', 'ali %', '% ali %', '% ali'])
    expect(q.raw).toEqual([])
    expect(createNotification).toHaveBeenCalledTimes(1)
    expect((createNotification as any).mock.calls[0][0]).toBe('u1')
  })

  it('does nothing when the content has no usable handle', async () => {
    const n = await notifyMentions({ ...base, content: '@a @e @m everyone!' })
    expect(n).toBe(0)
    expect(p.$queryRaw).not.toHaveBeenCalled()
  })

  it('skips members on either side of a block', async () => {
    p.$queryRaw.mockResolvedValue([{ id: 'u1', name: 'Ali' }, { id: 'u2', name: 'Ali B.' }])
    p.memberBlock.findMany.mockResolvedValue([{ blockerId: 'u2', blockedId: 'me' }])
    const n = await notifyMentions({ ...base, content: '@ali' })
    expect(n).toBe(1)
    expect((createNotification as any).mock.calls[0][0]).toBe('u1')
  })

  it('caps recipients even when many share a first name', async () => {
    p.$queryRaw.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, name: 'Ali' })))
    const n = await notifyMentions({ ...base, content: '@ali' })
    expect(n).toBe(MAX_RECIPIENTS)
    expect(createNotification).toHaveBeenCalledTimes(MAX_RECIPIENTS)
  })
})
