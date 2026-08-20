import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, deleteSession } from '@/lib/session'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { rateLimit } from '@/lib/rateLimit'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { writeAudit } from '@/lib/audit'
import { todayInCity, resolveCityId } from '@/lib/city'

// Account deletion follows an anonymize-and-clear strategy, not hard
// delete. The User row is preserved (with all identifying fields
// scrubbed) so that foreign-keyed business records — Payment,
// EventAttendee, Review — remain intact for accounting and event
// integrity. Everything else that holds the user's PII, content, or
// tracking data is explicitly cleared in a transaction below.
//
// What stays (deliberately):
//   - Payment rows (financial records — legal retention)
//   - EventAttendee rows on PAST events (attendance history is
//     event-level signal — upcoming rows are removed, see below)
//   - Review rows (public content; visible as "Deleted Member")
//   - Article authored rows (kept anonymously)
//   - Audit log entries naming the user (compliance / forensics)
//   - Report rows where the user is reporter or reported (forensics)
//   - HangoutReference rows where the user is the recipient (these are
//     references *about* the user written by others — they reference
//     other people's content)
//
// What goes (PII / inbox / tracking, no business need):
//   - PushSubscription, NotificationPreference, Notification (inbox)
//   - ProfileView, MemberBlock, Connection
//   - PasswordResetToken, EmailVerificationToken
//   - EventPhoto, ClubPhoto (user-uploaded media)
//   - HangoutJoin, AvailabilityPulse
//   - ClubMembership, CityHost
//   - CupPrediction, CupBracketPick, MemberNPS
//   - ClubPostLike, ClubPollVote, CommunityPollVote, NeighborhoodPostLike
//   - WaitlistEntry, SavedListing, MemberConnection
//   - EventAttendee rows on UPCOMING events (a deleted member won't
//     attend; their spot is freed via a spotsLeft recompute)
//   - HangoutReference where this user was the writer (fromUserId)
//   - Fingerprint history + knownIps on the User row itself
//
// What gets anonymized (user-authored content in threads / posts):
//   - DirectMessage, EventMessage, ClubPostReply, NeighborhoodPostReply,
//     HangoutMessage, ClubPost, NeighborhoodPost, Listing, VisitorAnnouncement
//   - The content/text/body is replaced with '[deleted]' so the
//     containing thread / post / listing stays readable but no
//     user-authored words survive.
const DELETED_BODY = '[deleted]'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`delete-account:${session.id}`, 3, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const { password } = await req.json()
  if (!password) return NextResponse.json({ error: 'Password is required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { password: true, status: true, name: true, email: true, phone: true, lastFingerprint: true },
  })
  if (!user || !user.password) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 })

  const id = session.id
  const ghost = `deleted_${randomBytes(6).toString('hex')}`

  // Single transaction so a mid-cleanup failure doesn't leave the
  // account partially scrubbed. Prisma's interactive transaction
  // automatically rolls back on any throw.
  await prisma.$transaction(async tx => {
    // ── 0. Decrement club memberCount for each approved membership ─────────
    // Must run before the membership rows are deleted below, or the cached
    // counts drift permanently high (the source of the recount problem).
    const approvedClubs = await tx.clubMembership.findMany({
      where:  { userId: id, status: 'approved' },
      select: { clubId: true },
    })
    for (const m of approvedClubs) {
      await tx.club.update({ where: { id: m.clubId }, data: { memberCount: { decrement: 1 } } })
    }

    // ── 0b. Free the spots the user holds on upcoming events ──────────────
    // Attendee rows on past events stay (attendance history), but a
    // deleted member won't attend anything upcoming: remove those rows
    // and re-derive each event's cached spotsLeft, or the events show
    // phantom "going" counts forever. Rows of any status go (a pending
    // request shouldn't linger for host approval), but only approved
    // rows consumed a spot, so only those events need a recompute.
    const upcomingAttending = await tx.eventAttendee.findMany({
      where:  { userId: id, event: { status: 'published', date: { gte: await todayInCity(await resolveCityId(session)) } } },
      select: { eventId: true, status: true, event: { select: { totalSpots: true } } },
    })
    if (upcomingAttending.length) {
      await tx.eventAttendee.deleteMany({
        where: { userId: id, eventId: { in: upcomingAttending.map(a => a.eventId) } },
      })
      for (const a of upcomingAttending.filter(a => a.status === 'approved')) {
        await recomputeSpotsLeft(a.eventId, a.event.totalSpots, tx)
      }
    }

    // ── 1. Hard delete: PII / inbox / tracking / transient state ──────────
    // Sequential, not Promise.all: an interactive transaction runs on a
    // single connection, so concurrent tx queries only trip pg's
    // "client.query() while already executing" warning (a hard error in
    // pg@9) — and Prisma serializes them anyway, so there's no speedup lost.
    await tx.pushSubscription.deleteMany({ where: { userId: id } })
    await tx.notificationPreference.deleteMany({ where: { userId: id } })
    await tx.notification.deleteMany({ where: { userId: id } })
    await tx.profileView.deleteMany({ where: { OR: [{ viewerId: id }, { viewedId: id }] } })
    await tx.memberBlock.deleteMany({ where: { OR: [{ blockerId: id }, { blockedId: id }] } })
    await tx.memberConnection.deleteMany({ where: { OR: [{ requesterId: id }, { receiverId: id }] } })
    await tx.emailVerificationToken.deleteMany({ where: { userId: id } })
    await tx.passwordResetToken.deleteMany({ where: { userId: id } })
    await tx.totpBackupCode.deleteMany({ where: { userId: id } })
    await tx.session.deleteMany({ where: { userId: id } })
    await tx.eventPhoto.deleteMany({ where: { userId: id } })
    await tx.clubPhoto.deleteMany({ where: { userId: id } })
    await tx.hangoutJoin.deleteMany({ where: { userId: id } })
    await tx.availabilityPulse.deleteMany({ where: { userId: id } })
    await tx.clubMembership.deleteMany({ where: { userId: id } })
    await tx.cityHost.deleteMany({ where: { userId: id } })
    await tx.cupPrediction.deleteMany({ where: { userId: id } })
    await tx.cupBracketPick.deleteMany({ where: { userId: id } })
    await tx.memberNPS.deleteMany({ where: { userId: id } })
    await tx.clubPostLike.deleteMany({ where: { userId: id } })
    await tx.clubPollVote.deleteMany({ where: { userId: id } })
    await tx.communityPollVote.deleteMany({ where: { userId: id } })
    await tx.neighborhoodPostLike.deleteMany({ where: { userId: id } })
    await tx.waitlistEntry.deleteMany({ where: { userId: id } })
    await tx.savedListing.deleteMany({ where: { userId: id } })
    await tx.hangoutReference.deleteMany({ where: { fromUserId: id } })

    // ── 2. Anonymize content authored by the user ─────────────────────────
    // The containing thread / post / listing stays readable, but the
    // user's words are replaced. Image references are nulled where
    // applicable so deleted-account photos don't render. Sequential for the
    // same single-connection reason as above.
    await tx.directMessage.updateMany({ where: { fromId: id }, data: { text: DELETED_BODY, imageUrl: null } })
    await tx.eventMessage.updateMany({ where: { userId: id }, data: { message: DELETED_BODY } })
    await tx.clubPostReply.updateMany({ where: { userId: id }, data: { content: DELETED_BODY } })
    await tx.neighborhoodPostReply.updateMany({ where: { userId: id }, data: { content: DELETED_BODY } })
    await tx.hangoutMessage.updateMany({ where: { userId: id }, data: { body: DELETED_BODY } })
    await tx.clubPost.updateMany({ where: { userId: id }, data: { content: DELETED_BODY } })
    await tx.neighborhoodPost.updateMany({ where: { userId: id }, data: { content: DELETED_BODY, imageUrl: null } })
    await tx.listing.updateMany({ where: { userId: id }, data: { description: DELETED_BODY, photo: null, status: 'expired' } })
    await tx.visitorAnnouncement.updateMany({ where: { userId: id }, data: { intro: DELETED_BODY } })

    // ── 3. Anonymize the User row itself ─────────────────────────────────
    // Status: banned is what evicts the session in getSession(); bump
    // tokenVersion too for consistency with other identity-change paths
    // (password reset, role change, etc.).
    await tx.user.update({
      where: { id },
      data: {
        name:             'Deleted Member',
        email:            `${ghost}@deleted.smileys`,
        password:         randomBytes(32).toString('hex'), // unusable password
        bio:              null,
        profilePhoto:     null,
        instagram:        null,
        linkedin:         null,
        phone:            null,
        neighborhood:     null,
        nationality:      null,
        languages:        [],
        interests:        [],
        lookingFor:       [],
        socialStyles:     [],
        color:            '#9ca3af',
        status:           'banned',
        membershipType:   'free',
        referralCode:     null,
        referralCount:    0,
        partnerId:        null,
        gender:           null,
        // Tracking arrays — leaving these populated would let admins
        // continue to recognize the user across accounts via fingerprints
        // even after they've exercised their right to be forgotten.
        fingerprints:     [],
        knownIps:         [],
        lastFingerprint:  null,
        // Auth state — null everything so a future signup with the same
        // email (impossible, since email is now ghost@deleted.smileys, but
        // defense in depth) doesn't inherit lockout / 2FA state.
        totpSecret:       null,
        totpEnabled:      false,
        lastUsedTotpStep: null,
        failedLoginCount: 0,
        loginLockedUntil: null,
        // Open-to flags — clear so the "Deleted Member" row doesn't
        // surface in any /open-to-X discovery view.
        openToCoffee:     false,
        openToLanguage:   false,
        openToHosting:    false,
        emailMarketing:   false,
        emailVerified:    false,
        // Moderation state — clear so the deleted account doesn't carry
        // forward appeal / suspension metadata.
        banReason:        'deleted',
        bannedAt:         new Date(),
        appealNote:       null,
        appealStatus:     null,
        appealedAt:       null,
        warningCount:     0,
        suspendedAt:      null,
        suspendedUntil:   null,
        suspendedBy:      null,
        suspensionNote:   null,
        // Invalidate every active session for this user — the cookie on
        // this device is also cleared below.
        tokenVersion:     { increment: 1 },
      },
    })
  }, {
    // 60s timeout — Prisma serializes operations on a single tx
    // connection (Promise.all inside an interactive transaction is NOT
    // actually parallel), so the ~30 sequential deleteMany/updateMany
    // ops below can take real time on a power user with tens of
    // thousands of notification / hangout / club-post-like rows. If we
    // still hit this ceiling, the next step is to flip the user to
    // status='deleting' synchronously and let a background sweeper
    // chunk through the rest.
    maxWait: 5_000,
    timeout: 60_000,
  })

  // Minimal, admin-only identity snapshot retained for safety / abuse
  // prevention — written AFTER the scrub, keyed by the (preserved) user id, so
  // an admin can still trace who a "Deleted Member" was if a safety question
  // arises. This is the one deliberate exception to the erasure above; it lives
  // only in the admin audit trail, never in a member-facing surface.
  await writeAudit(id, user.name ?? 'Member', 'account.self_delete', id, 'user',
    { name: user.name, email: user.email, phone: user.phone, fingerprint: user.lastFingerprint },
    `${user.name ?? id} deleted their own account`,
  )

  await deleteSession()
  return NextResponse.json({ ok: true })
}
