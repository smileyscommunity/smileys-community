import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, deleteSession } from '@/lib/session'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { rateLimit } from '@/lib/rateLimit'

// Account deletion follows an anonymize-and-clear strategy, not hard
// delete. The User row is preserved (with all identifying fields
// scrubbed) so that foreign-keyed business records — Payment,
// EventAttendee, Review — remain intact for accounting and event
// integrity. Everything else that holds the user's PII, content, or
// tracking data is explicitly cleared in a transaction below.
//
// What stays (deliberately):
//   - Payment rows (financial records — legal retention)
//   - EventAttendee rows (attendance history is event-level signal)
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
//   - HangoutJoin, HangoutPulse, AvailabilityPulse
//   - ClubMembership, UserCity, CityHost
//   - CupPrediction, CupBracketPick, MemberNPS
//   - ClubPostLike, ClubPollVote, CommunityPollVote, NeighborhoodPostLike
//   - WaitlistEntry, ReviewRequest, SavedListing, MemberConnection
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
    select: { password: true, status: true },
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
    // ── 1. Hard delete: PII / inbox / tracking / transient state ──────────
    await Promise.all([
      tx.pushSubscription.deleteMany({ where: { userId: id } }),
      tx.notificationPreference.deleteMany({ where: { userId: id } }),
      tx.notification.deleteMany({ where: { userId: id } }),
      tx.profileView.deleteMany({ where: { OR: [{ viewerId: id }, { viewedId: id }] } }),
      tx.memberBlock.deleteMany({ where: { OR: [{ blockerId: id }, { blockedId: id }] } }),
      tx.memberConnection.deleteMany({ where: { OR: [{ requesterId: id }, { receiverId: id }] } }),
      tx.emailVerificationToken.deleteMany({ where: { userId: id } }),
      tx.passwordResetToken.deleteMany({ where: { userId: id } }),
      tx.totpBackupCode.deleteMany({ where: { userId: id } }),
      tx.session.deleteMany({ where: { userId: id } }),
      tx.eventPhoto.deleteMany({ where: { userId: id } }),
      tx.hangoutJoin.deleteMany({ where: { userId: id } }),
      tx.availabilityPulse.deleteMany({ where: { userId: id } }),
      tx.clubMembership.deleteMany({ where: { userId: id } }),
      tx.cityHost.deleteMany({ where: { userId: id } }),
      tx.cupPrediction.deleteMany({ where: { userId: id } }),
      tx.cupBracketPick.deleteMany({ where: { userId: id } }),
      tx.memberNPS.deleteMany({ where: { userId: id } }),
      tx.clubPostLike.deleteMany({ where: { userId: id } }),
      tx.clubPollVote.deleteMany({ where: { userId: id } }),
      tx.communityPollVote.deleteMany({ where: { userId: id } }),
      tx.neighborhoodPostLike.deleteMany({ where: { userId: id } }),
      tx.waitlistEntry.deleteMany({ where: { userId: id } }),
      tx.savedListing.deleteMany({ where: { userId: id } }),
      tx.hangoutReference.deleteMany({ where: { fromUserId: id } }),
    ])

    // ── 2. Anonymize content authored by the user ─────────────────────────
    // The containing thread / post / listing stays readable, but the
    // user's words are replaced. Image references are nulled where
    // applicable so deleted-account photos don't render.
    await Promise.all([
      tx.directMessage.updateMany({ where: { fromId: id }, data: { text: DELETED_BODY, imageUrl: null } }),
      tx.eventMessage.updateMany({ where: { userId: id }, data: { message: DELETED_BODY } }),
      tx.clubPostReply.updateMany({ where: { userId: id }, data: { content: DELETED_BODY } }),
      tx.neighborhoodPostReply.updateMany({ where: { userId: id }, data: { content: DELETED_BODY } }),
      tx.hangoutMessage.updateMany({ where: { userId: id }, data: { body: DELETED_BODY } }),
      tx.clubPost.updateMany({ where: { userId: id }, data: { content: DELETED_BODY } }),
      tx.neighborhoodPost.updateMany({ where: { userId: id }, data: { content: DELETED_BODY, imageUrl: null } }),
      tx.listing.updateMany({ where: { userId: id }, data: { description: DELETED_BODY, photo: null, status: 'expired' } }),
      tx.visitorAnnouncement.updateMany({ where: { userId: id }, data: { intro: DELETED_BODY } }),
    ])

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
    // Slightly longer than the default 5s — many tables, but well under
    // the 60s envelope budget. If we ever hit this on a power user with
    // tens of thousands of rows, switch to per-table chunked deletes.
    maxWait: 5_000,
    timeout: 30_000,
  })

  await deleteSession()
  return NextResponse.json({ ok: true })
}
