import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, deleteSession } from '@/lib/session'
import bcrypt from 'bcryptjs'
import { rateLimit } from '@/lib/rateLimit'
import { totpReauth } from '@/lib/totpReauth'
import { anonymizeUser } from '@/lib/anonymizeUser'

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
//     HangoutMessage, ClubPost, NeighborhoodPost, Listing, VisitorAnnouncement,
//     BusinessClaim (message only — the claim row is the ownership record)
//   - The content/text/body is replaced with '[deleted]' so the
//     containing thread / post / listing stays readable but no
//     user-authored words survive.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`delete-account:${session.id}`, 3, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const { password, code } = await req.json()
  if (!password) return NextResponse.json({ error: 'Password is required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, password: true, status: true, name: true, email: true, phone: true, lastFingerprint: true,
              cityId: true, totpEnabled: true, totpSecret: true },
  })
  if (!user || !user.password) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 })

  // The same second proof the email change asks for. This is the one thing
  // here that can't be undone, and it used to ask for less.
  const reauth = await totpReauth(user, code)
  if (reauth) return reauth

  await anonymizeUser({ ...user, id: session.id })
  await deleteSession()
  return NextResponse.json({ ok: true })
}
