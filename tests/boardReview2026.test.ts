import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The community board review (2026-09-19). What these pin: a guest never
// reads an invite link, number or email off a post; every surface listing
// posts shares one read gate; a reply can be taken down by the people it
// concerns and nobody else; the old "interested" toggle can't be used to
// ping an author; reports go to the post's city.

vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    boardReply: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    memberBlock: { findMany: vi.fn(async () => []) },
  },
}))

import { getSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'
import { redactBoardTextForGuest } from '@/lib/boardAccess'
import { DELETE as deleteReply } from '@/app/api/board/[id]/replies/[replyId]/route'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('what a guest reads', () => {
  it('cuts invite links, numbers and emails', () => {
    const out = redactBoardTextForGuest(
      'Join https://chat.whatsapp.com/AbC123 or wa.me/905551112233, call +90 555 111 22 33, mail ayse@example.com',
    )
    expect(out).not.toMatch(/whatsapp|wa\.me|555|ayse@/)
    expect(out).toContain('[link for members]')
    expect(out).toContain('[number for members]')
    expect(out).toContain('[email for members]')
  })

  it('keeps years, prices and small counts', () => {
    const text = 'Since 2019, about 1500 TL, 3-4 people, 10:30 start on 18.09.2026 (or 2026-09-20)'
    expect(redactBoardTextForGuest(text)).toBe(text)
  })

  it('every public reader applies it to guests', () => {
    expect(src('app/api/board/route.ts')).toMatch(/const text = \(t: string\) => \(session \? t : redactBoardTextForGuest\(t\)\)/)
    expect(src('app/api/board/[id]/replies/route.ts')).toContain('body: session ? r.body : redactBoardTextForGuest(r.body)')
    expect(src('app/[city]/board/page.tsx')).toContain('body:  session ? p.body  : redactBoardTextForGuest(p.body)')
    expect(src('app/neighborhoods/[slug]/NeighborhoodSections.tsx')).toContain('myId ? bp.title : redactBoardTextForGuest(bp.title)')
  })
})

describe('one read gate', () => {
  it('the neighbourhood pages list only live authors, no private club, no blocked pair', () => {
    const s = src('app/neighborhoods/[slug]/NeighborhoodSections.tsx')
    const q = s.slice(s.indexOf('prisma.boardPost.findMany'), s.indexOf('prisma.boardPost.findMany') + 600)
    expect(q).toContain('user: LIVE_BOARD_AUTHOR')
    expect(q).toContain("OR: [{ clubId: null }, { club: { isPrivate: false } }]")
    expect(q).toContain('userId: { notIn: blockedIds }')
  })

  it('the city board hub lists board posts, not marketplace listings', () => {
    const d = src('app/[city]/data.ts')
    const hub = d.slice(d.indexOf('export const getCityBoardHub'))
    expect(hub).toContain('prisma.boardPost.findMany')
    expect(hub.slice(0, hub.indexOf("['city-board-hub-posts']"))).not.toContain('prisma.listing')
  })

  it('a private club\'s post names no neighbourhood', () => {
    expect(src('app/api/board/route.ts')).toContain('const neighborhood = privateClub ? null : await safeNeighborhoodFor(cityId, body.neighborhood)')
  })
})

describe('taking a reply down', () => {
  const reply = { postId: 'p1', userId: 'writer', removedAt: null, body: 'hi', post: { userId: 'op', cityId: 'istanbul' } }
  const call = () => deleteReply(new Request('https://x') as never, { params: Promise.resolve({ id: 'p1', replyId: 'r1' }) })
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.boardReply.findUnique as any).mockResolvedValue(reply)
  })

  it.each([
    ['its author',              { id: 'writer', role: 'member' }],
    ['the post\'s author',      { id: 'op',     role: 'member' }],
    ['the city\'s moderator',   { id: 'mod',    role: 'moderator', cityId: 'istanbul' }],
  ])('%s can', async (_l, who) => {
    ;(getSession as any).mockResolvedValue(who)
    expect((await call()).status).toBe(200)
    expect(prisma.boardReply.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { removedAt: expect.any(Date) } })
  })

  it.each([
    ['another member',              { id: 'someone', role: 'member' }],
    ['another city\'s moderator',   { id: 'mod2',    role: 'moderator', cityId: 'izmir' }],
  ])('%s can\'t', async (_l, who) => {
    ;(getSession as any).mockResolvedValue(who)
    expect((await call()).status).toBe(403)
    expect(prisma.boardReply.update).not.toHaveBeenCalled()
  })

  it('a reply id from another post is not found', async () => {
    ;(getSession as any).mockResolvedValue({ id: 'writer', role: 'member' })
    ;(prisma.boardReply.findUnique as any).mockResolvedValue({ ...reply, postId: 'other' })
    expect((await call()).status).toBe(404)
  })
})

describe('notifications', () => {
  it('"interested" is gone: the toggle that re-pinged an author on every off→on', () => {
    const s = src('app/api/board/[id]/react/route.ts')
    expect(s).toContain("if (kind !== 'save') {")
    expect(s).not.toContain('createNotification')
  })

  it('board replies can be muted and respect quiet hours', () => {
    const s = src('lib/notify.ts')
    expect(s).toMatch(/board_reply:\s+'wallReplies'/)
    expect(s).toMatch(/board_interest:\s+'wallReplies'/)
  })

  it('the member being replied to hears about it', () => {
    expect(src('app/api/board/[id]/replies/route.ts')).toMatch(/if \(repliedTo && repliedTo !== session\.id && repliedTo !== post\.userId/)
  })

  it('reports go to the post\'s city staff, and only for posts the reporter can read', () => {
    const s = src('app/api/board/[id]/report/route.ts')
    expect(s).toContain('where:  { id: boardPostId, ...readablePostWhere(session.id) }')
    expect(s).toContain('await notifyCityStaff(\n      post.cityId,')
    expect(s).not.toContain("role: { in: ['admin', 'moderator'] }")
  })
})

describe('moderation can act on the content', () => {
  it('a remove action exists and takes the post or reply down', () => {
    const s = src('app/api/admin/moderation/[id]/route.ts')
    expect(s).toContain("action !== 'remove'")
    expect(s).toContain("data: { removedAt: new Date() }")
    expect(s).toContain("data: { status: 'removed', pinned: false }")
  })

  it('a board report is filed under the post\'s city', () => {
    expect(src('app/api/admin/moderation/route.ts')).toContain('{ boardPostId: { in: cityBoardPostIds } }')
  })
})
