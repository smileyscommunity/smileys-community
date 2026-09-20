import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The notifications review (2026-09-20). A report told the member it was
// about who had reported them; an application pushed an applicant's name to
// moderators of cities that can't open it; a connections-only member's full
// name went out to every neighbour; a block didn't reach chat fan-outs; and a
// failed request read as "you're all caught up". These pin the fixes.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('a report', () => {
  const route = src('app/api/reports/route.ts')

  it('never reaches the member it names, nor the one who filed it', () => {
    // Either may hold a staff role, and the queue hides the report from both
    // — the reporter was promised anonymity from the person they reported.
    expect(route).toContain('const staffExcept = [reportedId, session.id] as const')
    expect(route).toContain("await notifyCityStaff(reportedUser.cityId, 'report', '🚨 New report',")
    expect(route).toContain('`/admin/users/${reportedId}`, staffExcept)')
    expect(route).not.toContain("role: { in: ['admin', 'moderator'] }")
    // The helper takes the exclusions and applies them in the query.
    const staff = src('lib/staffNotify.ts')
    expect(staff).toContain('except: readonly (string | null | undefined)[] = []')
    expect(staff).toContain('...(excluded.size ? { id: { notIn: [...excluded] } } : {}),')
  })

  it('goes to the staff of the city it belongs to, listings included', () => {
    const listing = src('app/api/listings/[id]/report/route.ts')
    expect(listing).toContain("await notifyCityStaff(listing.cityId, 'report', '🚨 Listing reported',")
    expect(listing).toContain('[listing.userId, session.id])')
  })
})

describe('an application', () => {
  it('reaches the staff of the city applied to, not every moderator everywhere', () => {
    const apply = src('app/api/apply/route.ts')
    expect(apply).toContain("await notifyCityStaff(targetCityId, 'application', notifTitle, notifBody, '/admin/applications')")
    expect(apply).toContain("await notifyCityStaff(targetCityId, 'application', '⚠️ Velocity block triggered',")
    expect(apply).not.toContain('const admins = await prisma.user.findMany({ where: { role: { in: [Role.Admin, Role.Moderator] } }')
  })
})

describe('being free to meet', () => {
  const route = src('app/api/availability/route.ts')

  it('names a connections-only member the way their profile does', () => {
    expect(route).toContain("me?.profileVisibility === 'connections' && !connectedIds.has(uid) ? firstNameOf(session.name) : session.name")
    // …and the feed itself withholds the photo and the nationality.
    expect(route).toContain('const restricted = await restrictedSetFor(session, pulses.map(p => p.user))')
    expect(route).toContain('profilePhoto: restricted.has(p.user.id) ? null : p.user.profilePhoto,')
    expect(route).toContain('nationality:  restricted.has(p.user.id) ? null : p.user.nationality,')
    // A wave comes from any neighbour, not necessarily a connection.
    expect(src('app/api/availability/[id]/wave/route.ts'))
      .toContain('`✋ ${connected ? session.name : firstNameOf(session.name)} is free too`')
  })
})

describe('a block', () => {
  it('reaches the chats a third party invited you both to', () => {
    expect(src('lib/memberPrivacy.ts')).toContain('export async function blockedIdsFor(userId: string): Promise<Set<string>> {')
    expect(src('app/api/hangouts/[id]/messages/route.ts')).toContain('const blocked = await blockedIdsFor(session.id)')
    expect(src('app/api/events/[id]/messages/route.ts')).toContain('for (const uid of await blockedIdsFor(session.id)) recipients.delete(uid)')
  })
})

describe('the notifications endpoint', () => {
  const route = src('app/api/notifications/route.ts')

  it('says how many are unread across every row, not just the page', () => {
    expect(route).toContain("prisma.notification.count({ where: { userId: session.id, isRead: false } }),")
    // Messages are broken out because each DM also writes one of these, and
    // the phone badge was adding them to the unread-message count.
    expect(route).toContain("prisma.notification.count({ where: { userId: session.id, isRead: false, type: 'message' } }),")
    expect(route).toContain("if (req.nextUrl.searchParams.get('count') === '1') {")
  })

  it('pages back through older ones', () => {
    expect(route).toContain("const beforeRaw = req.nextUrl.searchParams.get('before')")
    expect(route).toContain('take: PAGE + 1,')
    expect(route).toContain('hasMore,')
  })

  it('answers a failure as a failure, not as an empty inbox', () => {
    expect(route).toContain("return NextResponse.json({ error: 'Server error' }, { status: 500 })")
    expect(route).not.toContain('return NextResponse.json([])')
  })

  it('takes an id as a string, and says how many it cleared', () => {
    expect(route.match(/if \(id !== undefined && typeof id !== 'string'\) \{/g)?.length).toBe(2)
    expect(route).toContain('return NextResponse.json({ ok: true, deleted: count })')
  })
})

describe('what the switches gate', () => {
  const notify = src('lib/notify.ts')

  it("a change to a plan you joined follows the same switch as an event's", () => {
    expect(notify).toContain("hangout_updated:             'eventUpdates',")
  })

  it('the no-show v1 keys are gone with the engine', () => {
    expect(notify).not.toContain('no_show_yellow:')
    expect(notify).not.toContain('no_show_cards_issued:')
  })

  it('a bundle stays where the newest thing is, and reads what it is', () => {
    expect(notify.match(/createdAt: new Date\(\) \}/g)?.length).toBeGreaterThanOrEqual(3)
    // Decided on the link, not on whether the event's title says "joined".
    expect(notify).toContain("if (existing && !existing.link?.includes('tab=pending') && !link.includes('tab=pending')) {")
  })

  it('an unreadable recipient row no longer means "send it anyway" for broadcasts', () => {
    // …and only for the wide fan-outs: a message or an RSVP still goes.
    expect(notify).toContain('if (user === undefined ? BROADCAST_TYPES.has(type) : !!recipientSkipReason(user, type)) return true')
    expect(notify).toContain('export const BROADCAST_TYPES: ReadonlySet<string>')
  })

  it('a club wall post skips a suspended member, in one write and without a push', () => {
    const posts = src('app/api/clubs/[slug]/posts/route.ts')
    expect(posts).toContain('OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }],')
    // One insert for the club, not one lookup + insert + push per member.
    expect(posts).toContain('await prisma.notification.createMany({')
  })
})

describe('what a notification points at', () => {
  it("a deleted event takes its notifications with it", () => {
    expect(src('app/api/admin/events/[id]/route.ts'))
      .toContain('`/host/checkin?event=${id}`, `/admin/checkin?event=${id}`,')
  })

  it('signing out takes this device off the push list server-side too', () => {
    expect(src('app/api/auth/logout/route.ts')).toContain('where: { userId: session.id, sessionId: session.sessionId },')
  })
})
