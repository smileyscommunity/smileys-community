import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { getAvailableSpots } from '@/lib/db'
import { sendRsvpConfirmationEmail, sendWaitlistPromotedEmail } from '@/lib/email'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { autoJoinClub } from '@/lib/autoJoinClub'
import { sendPushToUser } from '@/lib/push'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`rsvp:${session.id}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id: eventId } = await params

    const body = await req.json().catch(() => ({}))
    const stealth = body?.stealth === true

    const [event, userRecord] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventId } }),
      prisma.user.findUnique({ where: { id: session.id }, select: { status: true, gender: true, nationality: true } }),
    ])
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.hostId === session.id) {
      return NextResponse.json({ error: 'Hosts cannot join their own event' }, { status: 400 })
    }
    if (userRecord?.status === 'banned') {
      return NextResponse.json({ error: 'Your account has been suspended' }, { status: 403 })
    }

    // Co-hosts attend for free — no spot consumed, no quotas applied
    const isCoHost = !!(await prisma.eventCoHost.findFirst({
      where: { eventId, userId: session.id },
    }))
    if (isCoHost) {
      const existing = await prisma.eventAttendee.findUnique({
        where: { userId_eventId: { userId: session.id, eventId } },
      })
      if (existing) return NextResponse.json({ error: 'Already joined' }, { status: 400 })
      await prisma.eventAttendee.create({ data: { userId: session.id, eventId, status: 'approved', stealth } })
      autoJoinClub(session.id, eventId).catch(() => {})
      createNotification(session.id, 'rsvp', 'You\'re in! 🎉', `Your spot for "${event.title}" is confirmed.`, `/events/${eventId}`)
      return NextResponse.json({ ok: true, status: 'approved' })
    }

    // Check if already attending or pending
    const existing = await prisma.eventAttendee.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (existing) return NextResponse.json({ error: 'Already joined' }, { status: 400 })

    // Check if already on waitlist
    const onWaitlist = await prisma.waitlistEntry.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (onWaitlist) return NextResponse.json({ error: 'Already on waitlist' }, { status: 400 })

    // Normalize gender / nationality so 'Male', 'MALE', 'male' all compare
    // equal and 'Türkiye' / 'Turkey' / 'TR' don't accidentally bypass the
    // Turkish-male sub-quota. Cheap, applies at compare time so existing
    // dirty data doesn't need a backfill.
    const userGender      = (userRecord?.gender      ?? '').trim().toLowerCase()
    const userNationality = (userRecord?.nationality ?? '').trim().toLowerCase()
    const TURKISH_VALUES = new Set(['turkey', 'türkiye', 'turkiye', 'tr', 'turkish'])
    const isMale         = userGender === 'male'
    const isFemale       = userGender === 'female'
    const isTurkish      = TURKISH_VALUES.has(userNationality)

    // Gender-balanced events require gender to be set
    if (event.genderBalance && !userGender) {
      return NextResponse.json({
        error: 'This event uses gender balance. Please set your gender in your profile settings before joining.',
      }, { status: 400 })
    }

    // Shared sets so the participants and RSVP routes count the same
    // variant spectrum without copy-paste rot.
    const MALE_VARIANTS    = ['male', 'Male', 'MALE']
    const FEMALE_VARIANTS  = ['female', 'Female', 'FEMALE']
    const TURKEY_VARIANTS  = ['Turkey', 'turkey', 'Türkiye', 'türkiye', 'Turkiye', 'TR']

    // Approval-required events create a 'pending' attendee instead of
    // auto-approving — that's the whole point of the flag. spotsLeft is NOT
    // decremented until the host/admin approves; the participants page
    // handles that.
    //
    // Quota POOL caps (2× the hard quota) apply at RSVP time so a flood of
    // same-gender requests doesn't fill the pending list with people the
    // host could never approve. Logic: if maleQuota = 10, allow up to 20
    // male approved+pending — the host gets twice as many candidates as
    // slots, plenty to pick from, without an unbounded pending stack. Male
    // 21 goes to waitlist with a "male spots are full" message so they
    // have honest signal.
    if (event.approvalRequired) {
      const [approvedCount, pendingCount] = await Promise.all([
        prisma.eventAttendee.count({ where: { eventId, status: 'approved' } }),
        prisma.eventAttendee.count({ where: { eventId, status: 'pending' } }),
      ])

      // Helper that pushes the caller onto the waitlist with the right
      // reason text and returns the response. Used by both the over-capacity
      // and the quota-pool blocks below so the wording stays consistent.
      const waitlistWithReason = async (reason: string) => {
        await prisma.waitlistEntry.create({ data: { userId: session.id, eventId } })
        const position = await prisma.waitlistEntry.count({ where: { eventId } })
        createNotification(session.id, 'waitlist', 'Added to waitlist 📋',
          `${reason} — you're #${position} on the waitlist.`,
          `/events/${eventId}`)
        return NextResponse.json({ ok: true, status: 'waitlisted', position })
      }

      if (approvedCount + pendingCount >= event.totalSpots) {
        return waitlistWithReason(`"${event.title}" has no open request slots right now`)
      }

      // Gender-pool caps at 2× hard quota for approval-required events.
      if (event.genderBalance && isMale) {
        const maleQuota = event.maleQuota ?? Math.floor(event.totalSpots / 2)
        const malePool = await prisma.eventAttendee.count({
          where: { eventId, status: { in: ['approved', 'pending'] }, user: { gender: { in: MALE_VARIANTS } } },
        })
        if (malePool >= maleQuota * 2) {
          return waitlistWithReason(`Male request pool for "${event.title}" is full (2× quota reached)`)
        }
      }
      if (event.genderBalance && isFemale && event.femaleQuota != null) {
        const femalePool = await prisma.eventAttendee.count({
          where: { eventId, status: { in: ['approved', 'pending'] }, user: { gender: { in: FEMALE_VARIANTS } } },
        })
        if (femalePool >= event.femaleQuota * 2) {
          return waitlistWithReason(`Female request pool for "${event.title}" is full (2× quota reached)`)
        }
      }
      if (event.turkishMaleQuota && isMale && isTurkish) {
        const turkishMalePool = await prisma.eventAttendee.count({
          where: {
            eventId, status: { in: ['approved', 'pending'] },
            user: { gender: { in: MALE_VARIANTS }, nationality: { in: TURKEY_VARIANTS } },
          },
        })
        if (turkishMalePool >= event.turkishMaleQuota * 2) {
          return waitlistWithReason(`Turkish male request pool for "${event.title}" is full (2× quota reached)`)
        }
      }

      // P4 fix: wrap attendee + payment creation in a $transaction
      // (the auto-approve path further down already does this). Without
      // it, a DB blip between the two statements would leave the
      // attendee row committed with no payment record — member appears
      // attending but the paid-event commitment is missing.
      //
      // P6 fix: clamp amount non-negative as defense in depth against
      // a misconfigured event.price. The event editor should reject
      // negative prices upstream, but we don't want a misconfig to
      // turn into a credit-to-the-member when admin marks the row
      // paid downstream.
      const safeAmount = Math.max(0, Number(event.price) || 0)
      await prisma.$transaction([
        prisma.eventAttendee.create({
          data: { userId: session.id, eventId, status: 'pending', stealth },
        }),
        ...(safeAmount > 0 ? [
          prisma.payment.create({
            data: { userId: session.id, eventId, amount: safeAmount, currency: event.currency ?? 'TRY', status: 'pending' },
          }),
        ] : []),
      ])
      createNotification(session.id, 'rsvp_pending', 'RSVP submitted ⏳',
        `Your request to join "${event.title}" is waiting on the host. You'll be notified once it's reviewed.`,
        `/events/${eventId}`)
      if (event.hostId) {
        createNotification(event.hostId, 'attendee_joined', 'New RSVP awaiting approval ⏳',
          `Someone just requested to join "${event.title}".`,
          `/host/events/${eventId}/participants`)
      }
      return NextResponse.json({ ok: true, status: 'pending' })
    }

    // Auto-approve path. Quota + spot checks happen in one transaction with
    // a row-level lock on the event, so concurrent RSVPs serialize and can't
    // both pass a quota at the boundary (e.g. two males both claiming the
    // last male slot).
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`

      if (event.genderBalance && isMale) {
        const maleQuota = event.maleQuota ?? Math.floor(event.totalSpots / 2)
        const maleCount = await tx.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: { in: MALE_VARIANTS } } },
        })
        if (maleCount >= maleQuota) return { kind: 'gender_full' as const }
      }

      // Female-side cap — mirrors the male check. Only enforced when
      // femaleQuota is explicitly set (event.femaleQuota null = uncapped).
      // Without this, an all-female RSVP wave could fill 100% of spots and
      // shut males out entirely.
      if (event.genderBalance && isFemale && event.femaleQuota != null) {
        const femaleCount = await tx.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: { in: FEMALE_VARIANTS } } },
        })
        if (femaleCount >= event.femaleQuota) return { kind: 'female_full' as const }
      }

      if (event.turkishMaleQuota && isMale && isTurkish) {
        const turkishMaleCount = await tx.eventAttendee.count({
          where: { eventId, status: 'approved',
            user: { gender: { in: MALE_VARIANTS }, nationality: { in: TURKEY_VARIANTS } } },
        })
        if (turkishMaleCount >= event.turkishMaleQuota) return { kind: 'turkish_full' as const }
      }

      const claimed = await tx.event.updateMany({
        where: { id: eventId, spotsLeft: { gt: 0 } },
        data:  { spotsLeft: { decrement: 1 } },
      })
      if (claimed.count === 0) return { kind: 'full' as const }

      await tx.eventAttendee.create({ data: { userId: session.id, eventId, status: 'approved', stealth } })

      // P6 defense-in-depth: clamp amount non-negative. Mirrors the
      // approval-required path above so a misconfigured event.price
      // can't land a negative payment row in either flow.
      const safeAmount = Math.max(0, Number(event.price) || 0)
      if (safeAmount > 0) {
        await tx.payment.create({
          data: { userId: session.id, eventId, amount: safeAmount, currency: event.currency ?? 'TRY', status: 'pending' },
        })
      }
      return { kind: 'approved' as const }
    })

    if (outcome.kind !== 'approved') {
      await prisma.waitlistEntry.create({ data: { userId: session.id, eventId } })
      const position = await prisma.waitlistEntry.count({ where: { eventId } })
      const reason =
        outcome.kind === 'gender_full'  ? `Male spots for "${event.title}" are full` :
        outcome.kind === 'female_full'  ? `Female spots for "${event.title}" are full` :
        outcome.kind === 'turkish_full' ? `Turkish male spots for "${event.title}" are full` :
                                          `"${event.title}" is full`
      createNotification(session.id, 'waitlist', 'Added to waitlist 📋',
        `${reason} — you're #${position} on the waitlist.`,
        `/events/${eventId}`)
      return NextResponse.json({ ok: true, status: 'waitlisted', position })
    }

    autoJoinClub(session.id, eventId).catch(() => {})

    createNotification(session.id, 'rsvp', 'You\'re in! 🎉', `Your spot for "${event.title}" is confirmed.`, `/events/${eventId}`)

    // Confirmation email + host notification (fire-and-forget)
    ;(async () => {
      const user = await prisma.user.findUnique({ where: { id: session.id }, select: { email: true, name: true } })
      if (user) {
        sendRsvpConfirmationEmail(
          user.email, user.name ?? 'Member',
          event.title, event.date,
          event.location ?? event.neighborhood ?? 'Istanbul',
          eventId,
        ).catch(() => {})
      }
      if (event.hostId) {
        createNotification(
          event.hostId,
          'attendee_joined',
          'New RSVP 🎉',
          `${user?.name ?? 'A member'} just signed up for "${event.title}"`,
          `/host/events/${eventId}/participants`,
        )
      }
    })()

    return NextResponse.json({ ok: true, status: 'approved' })

  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`rsvp-cancel:${session.id}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many cancellations' }, { status: 429 })
    }

    const { id: eventId } = await params

    // Check if on waitlist first
    const onWaitlist = await prisma.waitlistEntry.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (onWaitlist) {
      await prisma.waitlistEntry.delete({
        where: { userId_eventId: { userId: session.id, eventId } },
      })
      return NextResponse.json({ ok: true })
    }

    const existing = await prisma.eventAttendee.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (!existing) return NextResponse.json({ error: 'Not attending' }, { status: 400 })

    const wasApproved = existing.status === 'approved'

    // P2 fix: capture which pending payments will get cancelled so we
    // can write a PaymentLog row for each one. Previously the
    // updateMany flipped status to 'cancelled' silently — admin
    // viewing the audit trail on a cancelled row saw "no changes
    // recorded" because the PR 1 audit work only covered admin-
    // initiated mutations from the payments route.
    const pendingToCancel = await prisma.payment.findMany({
      where:  { userId: session.id, eventId, status: 'pending' },
      select: { id: true, amount: true, currency: true },
    })

    await prisma.$transaction([
      prisma.eventAttendee.delete({ where: { userId_eventId: { userId: session.id, eventId } } }),
      // Void any pending payment so no orphaned records remain
      prisma.payment.updateMany({
        where: { userId: session.id, eventId, status: 'pending' },
        data: { status: 'cancelled' },
      }),
      ...(pendingToCancel.length > 0 ? [
        // PaymentLog uses the member's session id/name in the actor
        // slot — the column is just a String, not a FK to admin role.
        // The note prefix "Member self-cancel" lets the admin payments
        // page distinguish these from admin-initiated cancellations at
        // a glance.
        prisma.paymentLog.createMany({
          data: pendingToCancel.map(p => ({
            paymentId:  p.id,
            adminId:    session.id,
            adminName:  session.name,
            fromStatus: 'pending',
            toStatus:   'cancelled',
            note:       `Member self-cancel via RSVP cancellation (₺${p.amount} ${p.currency})`,
          })),
        }),
      ] : []),
    ])

    // P8 fix: if this member had ALREADY PAID for the event, the
    // transaction above only voided their pending rows — paid rows
    // stay paid because the money is actually collected. Admin needs
    // a heads-up so they can process a refund (or not, per event
    // refund policy). Fan out a notification + write an
    // informational PaymentLog (fromStatus/toStatus null = "this is
    // a note, not a state change") so the admin payments page
    // surfaces the cancel context on the row.
    const paidPayments = await prisma.payment.findMany({
      where:  { userId: session.id, eventId, status: 'paid' },
      select: { id: true, amount: true, currency: true },
    })
    if (paidPayments.length > 0) {
      const [admins, evForNotify] = await Promise.all([
        prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } }),
        prisma.event.findUnique({ where: { id: eventId }, select: { title: true } }),
      ])
      const eventTitle = evForNotify?.title ?? 'an event'
      const totalPaid  = paidPayments.reduce((s, p) => s + p.amount, 0)
      await prisma.paymentLog.createMany({
        data: paidPayments.map(p => ({
          paymentId:  p.id,
          adminId:    session.id,
          adminName:  session.name,
          fromStatus: null,
          toStatus:   null,
          note:       `Member cancelled RSVP — payment still 'paid', refund pending admin review (₺${p.amount} ${p.currency})`,
        })),
      })
      // Notifications fire-and-forget — a transient notify failure
      // shouldn't block the member's cancel response.
      for (const a of admins) {
        createNotification(
          a.id,
          'payment_attention',
          'Paid attendee cancelled — refund?',
          `${session.name} cancelled their RSVP for "${eventTitle}" — ₺${totalPaid.toLocaleString()} was already paid. Review for refund.`,
          `/admin/payments?search=${encodeURIComponent(session.email)}`,
        ).catch(() => {})
      }
    }

    // Promote first person on waitlist (spot stays filled — no net change to spotsLeft)
    const [next, eventRow] = await Promise.all([
      wasApproved ? prisma.waitlistEntry.findFirst({ where: { eventId }, orderBy: { createdAt: 'asc' } }) : Promise.resolve(null),
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true, approvalRequired: true, totalSpots: true } }),
    ])
    if (next) {
      await prisma.$transaction([
        prisma.waitlistEntry.delete({ where: { id: next.id } }),
        prisma.eventAttendee.create({ data: { userId: next.userId, eventId, status: 'approved' } }),
      ])
      autoJoinClub(next.userId, eventId).catch(() => {})
      createNotification(next.userId, 'waitlist_promoted', 'Spot available! 🎉', `A spot opened up for "${eventRow?.title}" — you're in!`, `/events/${eventId}`)
      sendPushToUser(next.userId, { title: 'Spot available! 🎉', body: `A spot opened up for "${eventRow?.title}" — you're in!`, link: `/app/events/${eventId}` }).catch(() => {})
      // Email the promoted member (fire-and-forget)
      ;(async () => {
        const promoted = await prisma.user.findUnique({ where: { id: next.userId }, select: { email: true, name: true } })
        if (promoted && eventRow?.title) {
          const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { date: true } })
          // EM6 fix (same theme as AD-C): log SMTP failures so a
          // promoted member who never got their "you're in" email
          // can be traced via server logs.
          sendWaitlistPromotedEmail(promoted.email, promoted.name ?? 'Member', eventRow.title, ev?.date ?? '', eventId)
            .catch(err => console.error('[rsvp DELETE waitlist-promote] sendWaitlistPromotedEmail failed', { promotedUserId: next.userId, eventId, err: String(err) }))
        }
      })()
    }
    if (wasApproved) {
      if (eventRow?.approvalRequired) {
        await recomputeSpotsLeft(eventId, eventRow.totalSpots)
      } else if (!next) {
        // No waitlist — free the spot
        await prisma.event.update({ where: { id: eventId }, data: { spotsLeft: { increment: 1 } } })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ attending: false, waitlisted: false })

    const { id: eventId } = await params

    const [attendee, waitlistEntry] = await Promise.all([
      prisma.eventAttendee.findUnique({ where: { userId_eventId: { userId: session.id, eventId } } }),
      prisma.waitlistEntry.findUnique({ where: { userId_eventId: { userId: session.id, eventId } } }),
    ])

    let position: number | null = null
    if (waitlistEntry) {
      position = await prisma.waitlistEntry.count({
        where: { eventId, createdAt: { lte: waitlistEntry.createdAt } },
      })
    }

    return NextResponse.json({
      attending:  attendee?.status === 'approved',
      pending:    attendee?.status === 'pending',
      waitlisted: !!waitlistEntry,
      position,
    })
  } catch (e) {
    return NextResponse.json({ attending: false, waitlisted: false })
  }
}
