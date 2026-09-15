import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sixth scan, batch 26 — @mentions typed without the accent.
//   The prefilter folded case but only a hand-listed set of Turkish letters, so
//   "@René" found René while "@Rene" never loaded him (nor Zoë for "@Zoe",
//   Øystein for "@Oystein"). The query now folds the stored name with
//   translate() over one shared map — the same map foldName uses — and
//   mentionMatches stays the final whole-name gate.

const h = vi.hoisted(() => ({
  prisma: {
    $queryRaw:   vi.fn(),
    memberBlock: { findMany: vi.fn(async () => [] as any[]) },
  },
  createNotification: vi.fn(async () => true),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/notify', () => ({ createNotification: h.createNotification }))

import {
  foldName, notifyMentions, mentionPatterns, mentionCandidatesSql, mentionMatches,
  FOLD_FROM, FOLD_TO, FOLD_MULTI, MAX_RECIPIENTS,
} from '@/lib/mentions'
import { runMentionSql, parseMentionSql, type MentionRow } from './helpers/mentionSql'

const row = (id: string, name: string, over: Partial<MentionRow> = {}): MentionRow =>
  ({ id, name, status: 'approved', hiddenFromMembers: false, cityId: 'c1', ...over })

const USERS: MentionRow[] = [
  row('u-rene',    'René Dubois'),
  row('u-rene2',   'Rene Martin'),
  row('u-renee',   'Renée Blanc'),
  row('u-zoe',     'Zoë Kim'),
  row('u-oystein', 'Øystein Berg'),
  row('u-nandu',   'Ñandú Pérez'),
  row('u-aesa',    'Æsa Lund'),
  row('u-ayse',    'Ayşe Kaya'),
  row('u-ayla',    'Ayla Demir'),
  row('u-aylin',   'Aylin'),
  row('u-cagla',   'Çağla Öz'),
  row('u-isik',    'IŞIK TAN'),
  row('u-irem',    'İrem Su'),
  row('u-drali',   'Dr. Ali'),
  row('u-nguyen',  'Nguyễn Van'),
  row('u-hidden',  'Rene Staff', { hiddenFromMembers: true }),
  row('u-banned',  'René',       { status: 'banned' }),
  row('u-far',     'René Autre', { cityId: 'c2' }),
  row('me',        'Rene Me'),
]

const post = (content: string, cityId: string | null = 'c1') =>
  notifyMentions({ content, authorId: 'me', authorName: 'Me', cityId, link: '/neighborhoods/moda' })
const notified = () => h.createNotification.mock.calls.map((c: any[]) => c[0]).sort()
const lastQuery = () => h.prisma.$queryRaw.mock.calls.at(-1)![0] as { strings: string[]; values: unknown[] }

let table = USERS
beforeEach(() => {
  vi.clearAllMocks()
  table = USERS
  h.prisma.$queryRaw.mockImplementation(async (q: any) => runMentionSql(q, table))
  h.prisma.memberBlock.findMany.mockResolvedValue([])
})

describe('the fold map is one map, usable by translate()', () => {
  it('FOLD_FROM and FOLD_TO are the same length, character for character', () => {
    expect(Array.from(FOLD_FROM).length).toBe(Array.from(FOLD_TO).length)
    expect(new Set(Array.from(FOLD_FROM)).size).toBe(Array.from(FOLD_FROM).length)
    // translate() works per character; a multi-letter target would shift every
    // later pair. Those live in FOLD_MULTI instead.
    for (const c of Array.from(FOLD_TO)) expect(c).toMatch(/^[a-z']$/)
    for (const c of Array.from(FOLD_FROM)) expect(c).toMatch(/[^\x00-\x7f]/)
  })

  it('foldName agrees with the SQL fold on every entry', () => {
    const from = Array.from(FOLD_FROM), to = Array.from(FOLD_TO)
    from.forEach((c, i) => expect(foldName(c)).toBe(to[i]))
    for (const [c, t] of FOLD_MULTI) expect(foldName(c)).toBe(t)
  })

  it('covers the Turkish letters, dotless ı and capital İ', () => {
    for (const c of Array.from('çğıöşüÇĞİÖŞÜ')) expect(FOLD_FROM).toContain(c)
  })

  it('folds accents beyond Turkish and still folds Turkish', () => {
    expect(foldName('René')).toBe(foldName('Rene'))
    expect(foldName('Zoë')).toBe('zoe')
    expect(foldName('Ñandú')).toBe('nandu')
    expect(foldName('Øystein')).toBe('oystein')
    expect(foldName('Çağla')).toBe('cagla')
    expect(foldName('Işık')).toBe('isik')
    expect(foldName('IŞIK')).toBe(foldName('ışık'))
    expect(foldName('İrem')).toBe('irem')
    expect(foldName('Æsa')).toBe('aesa')
    expect(foldName('Groß')).toBe('gross')
    expect(foldName('D’Arcy')).toBe("d'arcy")
    // Decomposed input (another keyboard) folds like the composed row.
    expect(foldName('René')).toBe('rene')
  })
})

describe('patterns are whole words, bounded, escaped', () => {
  it('four whole-word shapes per spelling, whatever the name length', () => {
    expect(mentionPatterns(['René']).folded).toEqual(['rene', 'rene %', '% rene %', '% rene'])
    expect(mentionPatterns(['Constantinos']).folded).toHaveLength(4)
    // A mapped name needs no as-typed fallback; one the map misses does.
    expect(mentionPatterns(['René']).raw).toEqual([])
    expect(mentionPatterns(['Nguyễn']).raw).toEqual(['Nguyễn', 'Nguyễn %', '% Nguyễn %', '% Nguyễn'])
  })

  it('LIKE metacharacters in a token are literal', () => {
    expect(mentionPatterns(['a_b']).folded[0]).toBe('a\\_b')
    expect(mentionPatterns(['a%b']).folded[0]).toBe('a\\%b')
  })
})

describe('the wall resolver reaches accented names typed plain', () => {
  it('"@Rene" reaches René (and a plain Rene), never Renée', async () => {
    expect(await post('salut @Rene')).toBe(2)
    expect(notified()).toEqual(['u-rene', 'u-rene2'])
  })

  it('"@René" reaches the plain spelling too', async () => {
    expect(await post('salut @René')).toBe(2)
    expect(notified()).toEqual(['u-rene', 'u-rene2'])
  })

  it('"@Zoe", "@Oystein", "@Nandu", "@Aesa" reach Zoë, Øystein, Ñandú, Æsa', async () => {
    expect(await post('@Zoe @Oystein @Nandu @Aesa')).toBe(4)
    expect(notified()).toEqual(['u-aesa', 'u-nandu', 'u-oystein', 'u-zoe'])
  })

  it('Turkish still works both ways, İ and dotless ı included', async () => {
    expect(await post('@Cagla @Isik @irem')).toBe(3)
    expect(notified()).toEqual(['u-cagla', 'u-irem', 'u-isik'])
    vi.clearAllMocks()
    expect(await post('@ÇAĞLA @ışık @İrem')).toBe(3)
    expect(notified()).toEqual(['u-cagla', 'u-irem', 'u-isik'])
  })

  it('"@Ayse" and "@Ayşe" reach Ayşe only, never Ayla or Aylin', async () => {
    expect(await post('hey @Ayse')).toBe(1)
    expect(notified()).toEqual(['u-ayse'])
    vi.clearAllMocks()
    expect(await post('hey @Ayşe')).toBe(1)
    expect(notified()).toEqual(['u-ayse'])
  })

  it('a given name after a title is loaded (last word)', async () => {
    expect(await post('@Ali')).toBe(1)
    expect(notified()).toEqual(['u-drali'])
  })

  it('a letter outside the map still matches as typed', async () => {
    expect(await post('@Nguyễn')).toBe(1)
    expect(notified()).toEqual(['u-nguyen'])
  })

  it('hidden, banned, other-city accounts and the author are never loaded', async () => {
    await post('@Rene')
    const loaded = (await h.prisma.$queryRaw.mock.results[0].value as { id: string }[]).map(u => u.id).sort()
    expect(loaded).toEqual(['u-rene', 'u-rene2'])
    const q = parseMentionSql(lastQuery())
    expect(q.text).toContain(`status = 'approved'`)
    expect(q.text).toContain(`"hiddenFromMembers" = false`)
    expect(q.authorId).toBe('me')
    expect(q.cityId).toBe('c1')
    expect(q.limit).toBe(50)
  })

  it('without a city the query has no city predicate', async () => {
    await post('@Rene', null)
    expect(notified()).toEqual(['u-far', 'u-rene', 'u-rene2'])
    expect(parseMentionSql(lastQuery()).cityId).toBeUndefined()
  })

  it('blocks on either side are respected', async () => {
    h.prisma.memberBlock.findMany.mockResolvedValue([{ blockerId: 'u-rene2', blockedId: 'me' }])
    expect(await post('@Rene')).toBe(1)
    expect(notified()).toEqual(['u-rene'])
  })

  it('caps recipients at MAX_RECIPIENTS', async () => {
    table = Array.from({ length: 30 }, (_, i) => row(`r${i}`, i % 2 ? 'René' : 'Rene'))
    expect(await post('@Rene')).toBe(MAX_RECIPIENTS)
  })

  it('JS stays the final gate: a row the query over-returns is not notified', async () => {
    h.prisma.$queryRaw.mockResolvedValueOnce([{ id: 'x', name: 'Renée' }, { id: 'u-rene', name: 'René Dubois' }])
    expect(await post('@Rene')).toBe(1)
    expect(notified()).toEqual(['u-rene'])
    expect(mentionMatches('Renée', 'Rene')).toBe(false)
  })
})

describe('user input only ever travels as a bound parameter', () => {
  it('no token reaches the SQL text; the fold map is bound too', async () => {
    await post("@Rene @O'Brien @a_b @Zoë")
    expect(h.prisma.$queryRaw.mock.calls[0]).toHaveLength(1)
    const q = lastQuery()
    const text = q.strings.join('').toLowerCase()
    for (const t of ['rene', "o'brien", 'a_b', 'a\\_b', 'zoe', 'zoë']) expect(text).not.toContain(t)
    expect(q.values).toContain(FOLD_FROM)
    expect(q.values).toContain(FOLD_TO)
    expect(q.values).toContain("o'brien")
    expect(q.values).toContain('a\\_b %')
    expect(q.values).toContain('% zoe')
  })

  it('the builder is a Prisma.sql object, not a string', () => {
    const q = mentionCandidatesSql({ words: ["x'); DROP TABLE users; --"], authorId: 'me', cityId: 'c1' })
    expect(typeof q).toBe('object')
    expect(q.strings.join('')).not.toContain('DROP')
  })
})
