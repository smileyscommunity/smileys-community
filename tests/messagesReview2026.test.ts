import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The messages review (2026-09-20). Attaching a photo was broken for every
// member and public when it worked; after the first message the sender went
// silent; the inbox and thread handed out a private member's full name and
// photo; a block didn't stop reactions; and past 100 conversations the inbox
// kept the wrong ones. These pin the fixes.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('photos in a conversation', () => {
  it('the folder the composer uploads to is one the upload route accepts', () => {
    // This is how the feature shipped broken: the page posted `messages`,
    // nothing accepted it, and every member got "you can only upload profile
    // photos". A string compared against a string, so it can't drift again.
    const page = src('app/(member)/messages/[userId]/page.tsx')
    const folder = page.match(/fd\.append\('folder',\s*'([a-z]+)'\)/)?.[1]
    expect(folder).toBeTruthy()
    const upload = src('app/api/upload/route.ts')
    expect(upload).toContain(`folder === '${folder}'`)          // members may upload it
    expect(upload).toMatch(new RegExp(`const validFolders = \\[[^\\]]*'${folder}'`))  // and it lands there
    expect(src('app/api/files/[...path]/route.ts')).toMatch(new RegExp(`const VALID_FOLDERS = \\[[^\\]]*'${folder}'`))
  })

  it('a DM photo is served only to the two people in the conversation, and never cached publicly', () => {
    const files = src('app/api/files/[...path]/route.ts')
    expect(files).toContain("if (folder === 'messages') {")
    expect(files).toContain('where:  { imageUrl: url, deletedAt: null, OR: [{ fromId: session.id }, { toId: session.id }] }')
    // No staff bypass, and never a shared cache.
    expect(files).toContain('if (!seen) return new NextResponse(\'Forbidden\', { status: 403 })')
    expect(files).toContain(": privateFile ? 'private, max-age=300'")
    // And it isn't in the publicly-referenceable set.
    expect(src('lib/uploadedImageUrl.ts')).toMatch(/const PUBLIC_FOLDERS = \[(?!.*'messages')[^\]]*\]/)
    expect(src('lib/uploadedImageUrl.ts')).toContain("export const MESSAGE_FOLDERS = ['messages'] as const")
    // The send path accepts that folder only.
    expect(src('app/api/messages/[userId]/route.ts')).toContain('isUploadedImageUrl(imageUrl, MESSAGE_FOLDERS)')
  })
})

describe('being told about a message', () => {
  it('reading the thread clears the bell entry that silences the next one', () => {
    const route = src('app/api/messages/[userId]/route.ts')
    expect(route).toContain('await prisma.notification.updateMany({')
    expect(route).toContain("where: { userId: session.id, type: 'message', link: `/messages/${otherId}`, isRead: false },")
    // …and the skip has a backstop for someone who never opens it.
    expect(route).toContain('createdAt: { gte: new Date(Date.now() - 4 * 60 * 60_000) },')
    // A live back-and-forth pings once per burst, not once per message: with
    // the thread open, the reader clears the notice within four seconds, so
    // the unread check alone would let every message through.
    expect(route).toContain('await claimOnce(`dm-ping:${toId}:${session.id}`, 10 * 60_000)')
  })
})

describe('who the other person appears to be', () => {
  it('the inbox and the thread apply the same privacy rule as the profile', () => {
    const inbox = src('app/api/messages/route.ts')
    expect(inbox).toContain('const restricted = await restrictedSetFor(session, partners)')
    expect(inbox).toContain('name:         isRestricted ? firstNameOf(partner.name) : partner.name,')
    expect(inbox).toContain('profilePhoto: isRestricted ? null : partner.profilePhoto,')
    const thread = src('app/api/messages/[userId]/route.ts')
    expect(thread).toContain('...ordered.flatMap(m => (m.replyTo ? [m.replyTo.from] : [])),')
    // The push and bell name them the same way.
    expect(thread).toContain('const senderName = senderRestricted ? firstNameOf(session.name) : session.name')
  })
})

describe('blocking', () => {
  it('closes reactions too, and the reaction route is bounded and guarded', () => {
    const react = src('app/api/messages/[userId]/react/route.ts')
    expect(react).toContain('await isBlockedEitherWay(session.id, otherId)')
    expect(react).toContain('rateLimit(`dm-react:${session.id}`, 60, 60_000)')
    expect(react).toContain('if (!message || message.deletedAt)')
    expect(react).toContain('} catch (e) {')
  })

  it('leaves the blocker their own history, and takes the thread out of the inbox', () => {
    const thread = src('app/api/messages/[userId]/route.ts')
    expect(thread).toContain('if (blocks.some(b => b.blockerId === otherId)) {')
    expect(thread).toContain('readOnly = blocks.length > 0')
    const inbox = src('app/api/messages/route.ts')
    // Only a thread where THEY blocked me leaves the inbox; one I closed
    // stays, read-only — reporting a harasser needs the history.
    expect(inbox).toContain('if (!partner || blockedMe.has(pid)) return []')
    expect(inbox).toContain('blocked: iBlocked.has(pid),')
    // The badge counts every thread, not just this page of 100.
    expect(inbox).toContain('const totalUnread = unreadRows.reduce(')
    for (const c of ['components/Navbar.tsx', 'components/BottomNav.tsx']) {
      expect(src(c), c).toContain("if (typeof d?.totalUnread === 'number') setUnread(d.totalUnread)")
    }
  })
})

describe('the inbox itself', () => {
  it('keeps the newest conversations, not the lowest ids', () => {
    const inbox = src('app/api/messages/route.ts')
    const sql = inbox.slice(inbox.indexOf('SELECT * FROM ('), inbox.indexOf('LIMIT 100') + 9)
    expect(sql).toContain('ORDER BY partner, "createdAt" DESC')
    expect(sql.lastIndexOf('ORDER BY "createdAt" DESC')).toBeGreaterThan(sql.indexOf('ORDER BY partner'))
  })

  it('sends a short preview and says when it was a photo', () => {
    const inbox = src('app/api/messages/route.ts')
    expect(inbox).toContain('preview: { text: r.text.slice(0, 120), hasImage: !!r.imageUrl },')
  })
})

describe('sending', () => {
  it('spends the daily budget only on messages that are really sent', () => {
    const route = src('app/api/messages/[userId]/route.ts')
    expect(route.indexOf('rateLimit(`dm-day:')).toBeGreaterThan(route.indexOf("reason: 'not_connected'"))
    expect(route.indexOf('rateLimit(`dm-day:')).toBeGreaterThan(route.indexOf("reason: 'blocked'"))
  })

  it('says why it refused, and refuses an account that is no longer live', () => {
    const route = src('app/api/messages/[userId]/route.ts')
    expect(route).toContain("reason: 'not_connected'")
    expect(route).toContain("reason: 'blocked'")
    expect(route).toContain("if (!recipient || recipient.status !== 'approved') {")
  })

  it('caps every read, including the poll delta, and can page back', () => {
    const route = src('app/api/messages/[userId]/route.ts')
    expect(route).toContain('take: 100,')
    expect(route).toContain("const beforeRaw = searchParams.get('before')")
    expect(route).toContain('hasMore: !since && messages.length === 100,')
  })

  it('checks the delete body before Prisma sees it', () => {
    expect(src('app/api/messages/[userId]/route.ts')).toContain("if (typeof messageId !== 'string' || !messageId) {")
  })
})

describe('opening a chat', () => {
  it('is not a profile view, and the header can show presence', () => {
    const members = src('app/api/members/[id]/route.ts')
    expect(members).toContain("const fromChat = req.nextUrl.searchParams.get('context') === 'dm'")
    expect(members).toContain('recordView(session, id, self || fromChat)')
    expect(members).toContain('lastActive:   fullAccess ? user.lastActive : null,')
    expect(src('app/(member)/messages/[userId]/page.tsx')).toContain('context=dm')
  })
})

describe('the fixes\' own follow-ups', () => {
  it('a photo lookup has an index behind it', () => {
    expect(src('prisma/schema.prisma')).toContain('@@index([imageUrl])')
    expect(src('prisma/migrations/20260920000002_dm_image_index/migration.sql'))
      .toContain('CREATE INDEX "direct_messages_imageUrl_idx"')
  })

  it('a chat header costs four fields, not the whole profile', () => {
    expect(src('app/api/members/[id]/route.ts')).toContain('if (fromChat) {')
  })

  it('reading marks nothing when a poll tick brought nothing', () => {
    expect(src('app/api/messages/[userId]/route.ts')).toContain('if (!since || messages.length > 0) {')
  })

  it('a tab away for more than a page starts again instead of leaving a hole', () => {
    expect(src('app/(member)/messages/messageData.ts'))
      .toContain('if (opts.full && opts.pageSize && incoming.length >= opts.pageSize && current.length > 0 && oldestIncoming > newest) {')
  })

  it('a locked thread keeps checking back, slowly', () => {
    expect(src('app/(member)/messages/[userId]/page.tsx')).toContain('const every = lock ? 60_000 : 4_000')
  })
})
