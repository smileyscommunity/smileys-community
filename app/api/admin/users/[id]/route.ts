import { canManageUsers, canViewUserList, canSuspendUsers, canActInCity } from '@/lib/access'
import { snapshotUserHistory } from '@/lib/admin/userHistory'
import { requireStepUp } from '@/lib/stepUp'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { activeAttendeeWhere } from '@/lib/attendance'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'
import { sendPremiumUpgradeEmail, recordEmailFailure } from '@/lib/email'
import { isPremium } from '@/lib/membership'
import { writeAudit } from '@/lib/audit'
import { normalizeNeighborhoodInput } from '@/lib/neighborhoodsDb'
import { computeEventSurveyRollup, aggregateRollup } from '@/lib/survey'
import {formatName} from '@/lib/data'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { todayInCity, resolveCityId } from '@/lib/city'
import { setHomeCity } from '@/lib/cityMembership'
import { formatMoney } from '@/lib/data'
import { rateLimit, claimOnce, releaseClaim } from '@/lib/rateLimit'
import {
  mayReengage, reengageClaimKey, REENGAGE_DEDUPE_MS, REENGAGE_SEND_LIMIT, REENGAGE_WINDOW_MS, REENGAGE_MAX_LENGTH,
} from '../reengage/gate'

type Params = { params: Promise<{ id: string }> }

// What a PATCH hands back. It used to return the whole row from
// prisma.user.update — password hash, totpSecret, fingerprints and all — to
// the browser, and the detail page then replaced its state with it and
// crashed on the missing joinedEvents. Only the fields the admin pages read.
const USER_PATCH_SELECT = {
  id: true, name: true, email: true, role: true, status: true, membershipType: true,
  color: true, bio: true, neighborhood: true, instagram: true, phone: true,
  nationality: true, languages: true, interests: true, cityId: true,
  partnerId: true, industry: true, professionalRole: true, professionalStatus: true,
  suspendedUntil: true, suspensionNote: true, hiddenFromMembers: true,
  banReason: true, bannedAt: true, appealStatus: true, warningCount: true, emailVerified: true,
} as const

// Same closed set the member's own profile route accepts (api/auth/me).
const PRO_STATUSES = new Set(['social_only', 'open_to_networking', 'hiring', 'seeking_advice'])

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canViewUserList(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true,
        color: true, emailVerified: true, joinedAt: true,
        bio: true, neighborhood: true, instagram: true,
        phone: true, profilePhoto: true, nationality: true,
        languages: true, interests: true, cityId: true,
        status: true, membershipType: true, lastActive: true,
        // The Quick Edit form starts from these. Without them it opened blank
        // and every save sent partnerId: null, unlinking the member's partner.
        partnerId: true, industry: true, professionalRole: true, professionalStatus: true,
        warningCount: true, suspendedUntil: true, suspensionNote: true,
        // Read only to say whether the member has activated; never sent.
        password: true,
        adminNotes: {
          orderBy: { createdAt: 'desc' },
        },
        joinedEvents: {
          // Live RSVPs only — a cancelled row would read as a no-show below.
          where:   activeAttendeeWhere,
          include: { event: { select: { id: true, title: true, emoji: true, date: true, neighborhood: true, currency: true, price: true, city: { select: { timezone: true } } } } },
          orderBy: { joinedAt: 'desc' },
        },
        clubMemberships: {
          where: { role: 'host', status: 'approved' },
          include: { club: { select: { id: true, name: true, emoji: true } } },
        },
      },
    })
    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // City scope for non-admins — the LIST route is deliberately fail-closed
    // to the moderator's own city; without the same check here a moderator
    // holding any member's id could read every city's rosters one detail
    // page at a time. Same gate the PATCH applies. 404, not 403, so ids
    // can't be used to map which cities exist.
    if (!canViewUserList(session, user.cityId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const isAdmin = canManageUsers(session)
    let canSeePII = isAdmin

    // Moderators can see PII only if they are actively reviewing this user's application or report
    if (!canSeePII) {
      const [reviewedApplication, assignedReport] = await Promise.all([
        prisma.memberApplication.findFirst({ where: { email: user.email, reviewedBy: session.id } }),
        prisma.report.findFirst({ where: { reviewedBy: session.id, OR: [{ reporterId: id }, { reportedId: id }] } })
      ])
      if (reviewedApplication || assignedReport) {
        canSeePII = true
      }
    }

    if (!canSeePII) {
      user.email = user.email.split('@')[0].slice(0, 3) + '...@' + user.email.split('@')[1]
      if (user.phone) {
        user.phone = user.phone.slice(0, 4) + '...' + user.phone.slice(-2)
      }
    }

    // adminNotes is staff-internal commentary about a member — the most
    // sensitive text in the record. It's gated harder than email/phone: even
    // a moderator actively reviewing this user (canSeePII true) shouldn't read
    // other staff's private notes. Writing a note is already admin-only; make
    // reading match. Strip rather than mask — a redacted note is noise.
    if (!isAdmin) {
      ;(user as { adminNotes?: unknown }).adminNotes = []
    }

    // Host quality — aggregate post-event survey signal across every
    // event this user has hosted. The single most powerful host-
    // quality metric the platform has: an objective "would the room
    // come back?" number that's hard to game. Null when the user has
    // hosted zero events or no surveys have landed yet.
    const hostedEventIds = await prisma.event.findMany({
      where:  { hostId: id, status: { in: ['published', 'archived'] } },
      select: { id: true, title: true, date: true, emoji: true },
      orderBy: { date: 'desc' },
    })
    let hostQuality: {
      eventsHosted:    number
      surveyResponses: number
      wouldReturnRate: number | null
      anomalyCount:    number
      responseRate:    number | null
      recent:          { id: string; title: string; emoji: string; date: string; wouldReturnRate: number | null; responses: number; anomalyCount: number; responseRate: number | null }[]
    } | null = null

    if (hostedEventIds.length > 0) {
      // Per-event rollup + weighted aggregate via the shared helper.
      // Same shape used on /admin/events row + /admin/clubs/[id]
      // quality card so behaviour stays in lockstep.
      const rollupMap = await computeEventSurveyRollup(hostedEventIds.map(e => e.id))
      const allRows   = Array.from(rollupMap.values())
      const agg       = aggregateRollup(allRows)

      const recent = hostedEventIds.slice(0, 6).map(e => {
        const r = rollupMap.get(e.id)
        return {
          id:              e.id,
          title:           e.title,
          emoji:           e.emoji,
          date:            e.date,
          responses:       r?.responses        ?? 0,
          wouldReturnRate: r?.wouldReturnRate ?? null,
          anomalyCount:    r?.anomalyCount    ?? 0,
          responseRate:    r?.responseRate    ?? null,
        }
      })

      hostQuality = {
        eventsHosted:    hostedEventIds.length,
        surveyResponses: agg?.totalResponses  ?? 0,
        wouldReturnRate: agg?.wouldReturnRate ?? null,
        anomalyCount:    agg?.anomalyCount    ?? 0,
        responseRate:    agg?.responseRate    ?? null,
        recent,
      }
    }

    // What the member has actually paid, per currency. The page used to sum
    // the list price of every RSVP — upcoming, unpaid and pending included,
    // across currencies — under the viewer's currency sign. Payments are
    // admin-only everywhere else, so moderators get none.
    const paidTotals = isAdmin
      ? (await prisma.payment.groupBy({
          by:    ['currency'],
          where: { userId: id, status: 'paid' },
          _sum:  { amount: true },
        })).map(g => ({ currency: g.currency, amount: g._sum.amount ?? 0 }))
      : null

    const { password, ...rest } = user
    return NextResponse.json({ ...rest, hasPassword: !!password, hostQuality, paidTotals })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await req.json()

    // Fetch the target's cityId early — every capability check below
    // needs it to verify cross-city moderator escalation isn't
    // happening. Bundles with the `before` snapshot we'd be fetching
    // for the audit log anyway so this isn't an extra round-trip.
    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true, status: true, name: true, email: true, phone: true, suspendedUntil: true, cityId: true, membershipType: true, neighborhood: true, bannedAt: true },
    })
    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Re-engagement notification shortcut — the Retention page's "Send
    // notification". Moderators send it to their own city's members (see
    // ../reengage/gate.ts); it used to demand admin, so every moderator 403'd.
    if ('_reengage' in body) {
      if (!mayReengage(session, target.cityId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const message = typeof body._reengage === 'string' ? body._reengage.trim() : ''
      if (!message) return NextResponse.json({ error: 'Message is empty' }, { status: 400 })
      if (message.length > REENGAGE_MAX_LENGTH) {
        return NextResponse.json({ error: `Keep it under ${REENGAGE_MAX_LENGTH} characters` }, { status: 400 })
      }
      const claimKey = reengageClaimKey(id)
      if (!await claimOnce(claimKey, REENGAGE_DEDUPE_MS)) {
        return NextResponse.json({ error: 'This member was already nudged in the last 7 days.' }, { status: 409 })
      }
      // Counted after the week's claim, so a refused repeat doesn't use a send.
      if (!await rateLimit(`reengage-send:${session.id}`, REENGAGE_SEND_LIMIT, REENGAGE_WINDOW_MS)) {
        await releaseClaim(claimKey)
        return NextResponse.json({ error: 'Too many nudges sent — try again in a while.' }, { status: 429 })
      }
      const delivered = await createNotification(id, 'announcement', '👋 We miss you!', message, '/events')
      if (!delivered) {
        // The write failed: hand the week back so the next try can send.
        await releaseClaim(claimKey)
        return NextResponse.json({ error: 'Could not send the notification — try again.' }, { status: 502 })
      }
      writeAudit(session.id, session.name, 'user.reengage', id, 'user',
        { name: target.name, cityId: target.cityId },
        `Re-engagement nudge sent to ${target.name ?? id}`,
      )
      return NextResponse.json({ ok: true })
    }

    // Capability Checks — moderators are scoped to their own city so a
    // Berlin mod can't suspend an Istanbul user via a direct API call
    // even if they hold the id.
    const adminPrivilege = canManageUsers(session)
    const modPrivilege   = canSuspendUsers(session)

    if (!adminPrivilege && !modPrivilege) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Belt-and-braces: even an admin operating cross-city sees the
    // canActInCity result, so a future "admins can be city-scoped"
    // toggle would just work without rewiring this check.
    if (!canActInCity(session, target.cityId) && !adminPrivilege) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const whitelist = [
      'status', 'role', 'membershipType', 'banReason', 'bannedAt',
      'appealStatus', 'bio', 'neighborhood', 'instagram', 'phone', 'nationality',
      'languages', 'interests', 'color', 'name',
      'suspendedUntil', 'suspensionNote', 'partnerId',
      'hiddenFromMembers', 'email',
      // The Quick Edit form has always shown these; without them here the
      // edits were dropped while the page said "Profile updated".
      'industry', 'professionalRole', 'professionalStatus',
    ] as const

    const allowed: Record<string, unknown> = {}
    for (const key of whitelist) {
      if (key in body) {
        if (key === 'partnerId' && body[key] === '') {
          allowed[key] = null
        } else {
          allowed[key] = body[key]
        }
      }
    }

    // Restriction: Moderators can ONLY suspend or warn, not change roles/status/etc
    if (!adminPrivilege && modPrivilege) {
      const modOnlyAllowed = ['suspendedUntil', 'suspensionNote']
      const attempted = Object.keys(allowed)
      if (attempted.some(k => !modOnlyAllowed.includes(k))) {
        return NextResponse.json({ error: 'Moderators can only manage suspensions' }, { status: 403 })
      }
    }

    // Home city. Members move themselves in /settings, but staff can't (their
    // city IS their moderation scope — lib/cityMembership), so an admin has to
    // be able to do it for them. Admins only, and through the same helper, so
    // the old city stays on their list and the neighbourhood is cleared.
    // The move itself runs LAST (below), after every other field has been
    // validated: moving first and then rejecting the neighbourhood left the
    // member moved, their neighbourhood cleared, and the save reported as a
    // failure.
    const moveTo = 'homeCitySlug' in body ? String(body.homeCitySlug ?? '').trim() : null
    if (moveTo !== null) {
      if (!adminPrivilege) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      if (!moveTo) return NextResponse.json({ error: 'City is required' }, { status: 400 })
    }

    if (Object.keys(allowed).length === 0 && !moveTo) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    if (typeof allowed.name === 'string') {
      allowed.name = formatName(allowed.name)
      if (!allowed.name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    }

    // Neighborhood is validated against the TARGET member's city, not the
    // admin's: editing a Bodrum member from an Istanbul admin session must not
    // be able to save an Istanbul district onto them. An unrecognised value is
    // rejected rather than stored, because a stored one silently drops that
    // member out of every neighborhood feature (see
    // scripts/archive/fix-member-neighborhoods.ts for the 33 rows this produced).
    //
    // A value the form sent back unchanged is not an edit. A member still on a
    // legacy neighborhood (not in the registry) got a 400 on EVERY Quick Edit
    // save — any field — because the form always re-sent it.
    if ('neighborhood' in allowed && (allowed.neighborhood ?? null) === (target.neighborhood ?? null)) {
      delete allowed.neighborhood
    }
    if ('neighborhood' in allowed) {
      // Against the city they will live in when this save finishes — moving
      // a member and giving them a neighbourhood there is one save.
      const cityForNeighborhood = moveTo
        ? (await prisma.city.findUnique({ where: { slug: moveTo }, select: { id: true } }))?.id ?? target.cityId
        : target.cityId
      const parsed = await normalizeNeighborhoodInput(cityForNeighborhood, allowed.neighborhood)
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
      allowed.neighborhood = parsed.value
    }

    // Validate enum values
    if (allowed.role !== undefined && !['admin', 'moderator', 'member'].includes(allowed.role as string)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    // Granting a role is the one field in this whitelist that hands out
    // capability, so it needs more than a password behind it. Only fires when
    // a role is actually being set — the rest of a PATCH (bio, neighborhood,
    // suspension) stays on the plain capability checks above.
    if (allowed.role !== undefined) {
      const stepUp = requireStepUp(session)
      if (stepUp) return stepUp
    }
    // Taking a member's standing away needs the same. Suspending and banning
    // are the two writes here that cut someone off (and email them about it);
    // lifting either, or editing a profile field, stays on the plain checks.
    // canSuspendUsers is admin-only, so this never asks a moderator.
    if (allowed.status === 'banned' || allowed.suspendedUntil) {
      const stepUp = requireStepUp(session)
      if (stepUp) return stepUp
    }
    if (allowed.status !== undefined && !['approved', 'pending', 'banned'].includes(allowed.status as string)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    // A self-deleted account is anonymised to a …@deleted.smileys address and
    // left 'banned' only so its sessions end. Unbanning it would bring back
    // a ghost login, not a member.
    if (allowed.status !== undefined && allowed.status !== 'banned' && target.email.endsWith('@deleted.smileys')) {
      return NextResponse.json({ error: 'This account was deleted by its owner and cannot be restored' }, { status: 400 })
    }
    // membershipType is currently a free-form column with a UI offering
    // 'free' | 'premium' | 'vip'. The audit flagged it as the only field
    // in this whitelist with no enum validation. Locking it down now so a
    // future capability check that reads it can't be bypassed by an admin
    // typo (or a compromised admin session writing junk).
    if (allowed.membershipType !== undefined && !['free', 'premium', 'vip'].includes(allowed.membershipType as string)) {
      return NextResponse.json({ error: 'Invalid membershipType' }, { status: 400 })
    }
    if (allowed.hiddenFromMembers !== undefined && typeof allowed.hiddenFromMembers !== 'boolean') {
      return NextResponse.json({ error: 'Invalid hiddenFromMembers' }, { status: 400 })
    }
    // Professional fields: same rules as the member's own profile save.
    // Empty clears; the status is a closed set because the Pro directory
    // filters on it.
    for (const key of ['industry', 'professionalRole'] as const) {
      if (key in allowed) {
        const v = allowed[key]
        if (v === null || v === '') allowed[key] = null
        else if (typeof v !== 'string' || v.trim().length > 60) return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
        else allowed[key] = v.trim()
      }
    }
    if ('professionalStatus' in allowed) {
      const v = allowed.professionalStatus
      if (v === null || v === '') allowed.professionalStatus = null
      else if (typeof v !== 'string' || !PRO_STATUSES.has(v)) {
        return NextResponse.json({ error: 'Invalid professionalStatus' }, { status: 400 })
      }
    }
    // A partner id that doesn't exist would reach the foreign key and 500.
    if ('partnerId' in allowed && allowed.partnerId !== null) {
      const partner = typeof allowed.partnerId === 'string'
        ? await prisma.partner.findUnique({ where: { id: allowed.partnerId }, select: { id: true } })
        : null
      if (!partner) return NextResponse.json({ error: 'Unknown partner' }, { status: 400 })
    }
    // Email change — admin-only in practice (mod restriction above), since
    // email is the login identifier. Normalize, validate, and enforce
    // uniqueness with a clear error instead of a P2002 500. No-op values
    // are dropped so routine profile saves don't trip the checks or audit.
    if (allowed.email !== undefined) {
      if (typeof allowed.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(allowed.email.trim())) {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
      }
      allowed.email = allowed.email.trim().toLowerCase()
      if (allowed.email === target.email) {
        delete allowed.email
      } else {
        const taken = await prisma.user.findUnique({ where: { email: allowed.email as string }, select: { id: true } })
        if (taken) return NextResponse.json({ error: 'That email is already in use by another account' }, { status: 409 })
      }
    }
    // The move, now that every other field has been accepted — moving first
    // and then rejecting one left the member moved and the save reported as
    // a failure. setHomeCity clears the neighbourhood (it belongs to the old
    // city's registry); a neighbourhood in this same save is written by the
    // update below, which runs after this and was validated against the new
    // city.
    if (moveTo) {
      const moved = await setHomeCity(id, moveTo, { byAdmin: true })
      if (!moved.ok) return NextResponse.json({ error: moved.error }, { status: 400 })
      if (!moved.alreadyHome) {
        await writeAudit(session.id, session.name, 'user.home_city_changed', id, 'user',
          { from: target.cityId, to: moved.city.id, cityId: moved.city.id },
          `Moved ${target.name ?? 'a member'} to ${moved.city.name}`)
      }
    }

    // The no-op email drop above can leave nothing to update (e.g. a
    // profile save that only re-sent the current email) — succeed quietly
    // instead of tripping prisma with an empty data object.
    if (Object.keys(allowed).length === 0) {
      const unchanged = await prisma.user.findUnique({ where: { id }, select: USER_PATCH_SELECT })
      return NextResponse.json(unchanged)
    }

    // Prevent demoting/banning/suspending yourself
    if (id === session.id) {
      if (allowed.status === 'banned' || allowed.role || allowed.suspendedUntil) {
        return NextResponse.json({ error: 'Cannot change your own role, status or suspension' }, { status: 400 })
      }
    }

    if (allowed.status === 'banned') {
      allowed.bannedAt = new Date()
    }

    if (allowed.suspendedUntil) {
      allowed.suspendedAt = new Date()
      allowed.suspendedBy = session.id
    }

    // Capture before state for richer audit descriptions — reuses
    // the earlier fetch since we already pulled the target row for
    // the city-scope check.
    const before = target

    // role is read from the JWT body (not refreshed from DB by getSession), so a
    // demoted admin would keep session.role === 'admin' until their next login
    // without this. Bumping tokenVersion forces them through getSession's revocation
    // path on their next request.
    if ((allowed.role !== undefined && allowed.role !== before?.role) ||
        (allowed.status !== undefined && allowed.status !== before?.status) ||
        (allowed.suspendedUntil !== undefined)) {
      allowed.tokenVersion = { increment: 1 }
    }

    // An email edit moves the member's application with it, in one
    // transaction: applications are keyed by email, and one left on the old
    // address looks orphaned (the 2026-09-14 scrub erased live members' rows
    // that way) and escapes self-deletion's scrub.
    const user = allowed.email !== undefined
      ? (await prisma.$transaction([
          prisma.user.update({ where: { id }, data: allowed, select: USER_PATCH_SELECT }),
          prisma.memberApplication.updateMany({
            where: { email: { equals: target.email, mode: 'insensitive' } },
            data:  { email: allowed.email as string },
          }),
        ]))[0]
      : await prisma.user.update({ where: { id }, data: allowed, select: USER_PATCH_SELECT })

    // Premium/VIP grant → celebrate it (in-app + email). Fires only on a
    // genuine upgrade FROM a non-paid tier INTO a paid one — so re-saving an
    // already-premium member, or a VIP→Premium *downgrade*, never sends a
    // "🎉 you're now Premium" message.
    if (allowed.membershipType && allowed.membershipType !== before?.membershipType
        && isPremium(allowed.membershipType as string) && !isPremium(before?.membershipType)) {
      const tierLabel = allowed.membershipType === 'vip' ? 'VIP' : 'Premium'
      createNotification(id, 'membership_upgraded', `🎉 You're now a ${tierLabel} member!`,
        `Your Smileys membership has been upgraded to ${tierLabel}. Your badge now shows across the community.`,
        '/profile').catch(() => {})
      if (before?.email) {
        sendPremiumUpgradeEmail(before.email, before.name ?? 'there', tierLabel).catch(async err => {
          console.error('[user PATCH membership] upgrade email failed', { id, err: String(err) })
          await recordEmailFailure({ helper: 'sendPremiumUpgradeEmail', recipient: before.email!, error: err, context: { userId: id } })
        })
      }
    }

    // Auto-add to blacklist on ban so they can't re-apply
    if (allowed.status === 'banned' && before?.email) {
      await prisma.blacklist.upsert({
        where:  { email: before.email },
        create: {
          email:    before.email,
          phone:    before.phone    ?? undefined,
          name:     before.name     ?? undefined,
          reason:   typeof allowed.banReason === 'string' && allowed.banReason ? allowed.banReason : 'banned',
          bannedBy: session.name,
        },
        update: {},
      }).catch(err => console.error('[user PATCH ban] blacklist upsert failed', { id, email: before.email, err: String(err) }))
      // Kill any outstanding activation / reset links. Activation tokens are
      // passwordResetToken rows with a 7-day window — left alive, a banned
      // member could click the link still in their inbox and reactivate
      // (the activate route now also checks status, but the token should
      // not survive the ban either way).
      await prisma.passwordResetToken.deleteMany({ where: { userId: id } })
        .catch(err => console.error('[user PATCH ban] token cleanup failed', { id, err: String(err) }))
    }

    // Unban → take away the blacklist row the ban put there. Activation and
    // registration both refuse a blacklisted email, so an unbanned member
    // who had not activated yet could never get in. Only rows created at or
    // after this ban are removed: an entry that predates it was a separate
    // decision (the Blacklist page), not this ban's side effect. A legacy ban
    // with no bannedAt can't be told apart, so it is left for the Blacklist
    // page too.
    if (before.status === 'banned' && allowed.status !== undefined && allowed.status !== 'banned'
        && before.email && before.bannedAt) {
      const removed = await prisma.blacklist.findMany({
        where:  { email: { equals: before.email, mode: 'insensitive' }, createdAt: { gte: before.bannedAt } },
        select: { id: true, email: true, phone: true, reason: true, bannedBy: true, createdAt: true },
      }).catch(err => { console.error('[user PATCH unban] blacklist lookup failed', { id, err: String(err) }); return [] })
      const cleared = removed.length
        ? await prisma.blacklist.deleteMany({ where: { id: { in: removed.map(r => r.id) } } })
            .then(() => true)
            .catch(err => { console.error('[user PATCH unban] blacklist removal failed', { id, err: String(err) }); return false })
        : false
      if (cleared) {
        writeAudit(session.id, session.name, 'blacklist.remove', id, 'user',
          { name: before.name, cityId: before.cityId, reason: 'unban', entries: removed.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })) },
          `Blacklist entry removed on unban of ${before.name ?? id} (${before.email})`,
        )
      }
    }

    if (allowed.email !== undefined) {
      writeAudit(session.id, session.name, 'user.email_change', id, 'user',
        { from: before.email, to: allowed.email, name: before?.name },
        `Email changed for ${before?.name ?? id}: ${before.email} → ${allowed.email}`,
      )
    }

    if (allowed.hiddenFromMembers !== undefined) {
      writeAudit(session.id, session.name, 'user.visibility_change', id, 'user',
        { hiddenFromMembers: allowed.hiddenFromMembers, name: before?.name },
        `${before?.name ?? id} ${allowed.hiddenFromMembers ? 'hidden from' : 'restored to'} the members list`,
      )
    }

    if (allowed.role === 'moderator') {
      createNotification(id, 'host_assigned', "You're now a moderator 🛡️", 'You can now review membership applications and suggest decisions.', '/admin/applications').catch(() => {})
    }

    if (allowed.role && allowed.role !== before?.role) {
      writeAudit(session.id, session.name, 'user.role_change', id, 'user',
        { from: before?.role, to: allowed.role, name: before?.name },
        `Role changed from ${before?.role ?? '?'} to ${allowed.role} for ${before?.name ?? id}`,
      )
    }

    if (allowed.suspendedUntil && allowed.suspendedUntil !== before?.suspendedUntil) {
      const until = new Date(allowed.suspendedUntil as string)
      const reason = (allowed.suspensionNote as string) || 'violation of community guidelines'
      createNotification(id, 'rsvp', 'Account temporarily suspended', `Your account is suspended until ${until.toLocaleDateString()} for: ${reason}`).catch(() => {})
      writeAudit(session.id, session.name, 'user.suspend', id, 'user',
        { until, reason, name: before?.name },
        `${before?.name ?? id} suspended until ${until.toLocaleDateString()} — ${reason}`,
      )
    }

    if (allowed.status && allowed.status !== before?.status) {
      // Keep club memberCount in sync with bans: a banned member shouldn't
      // be counted, and unbanning restores the count. Membership rows are
      // preserved either way, so an unban brings the member back intact.
      if (allowed.status === 'banned' || before?.status === 'banned') {
        const approvedClubs = await prisma.clubMembership.findMany({
          where:  { userId: id, status: 'approved' },
          select: { clubId: true },
        })
        if (approvedClubs.length) {
          const delta = allowed.status === 'banned' ? { decrement: 1 } : { increment: 1 }
          await prisma.$transaction(approvedClubs.map(m =>
            prisma.club.update({ where: { id: m.clubId }, data: { memberCount: delta } })
          ))
        }
      }
      if (allowed.status === 'banned') {
        const reason = typeof allowed.banReason === 'string' && allowed.banReason ? allowed.banReason : 'violation of community guidelines'
        createNotification(id, 'rsvp', 'Your account has been suspended', `Your account was suspended: ${reason}. Contact us if you believe this is a mistake.`).catch(() => {})
        writeAudit(session.id, session.name, 'user.ban', id, 'user',
          { reason, name: before?.name },
          `${before?.name ?? id} banned — ${reason}`,
        )
      } else {
        writeAudit(session.id, session.name, 'user.status_change', id, 'user',
          { from: before?.status, to: allowed.status, name: before?.name },
          `Status changed from ${before?.status ?? '?'} to ${allowed.status} for ${before?.name ?? id}`,
        )
      }
    }

    return NextResponse.json(user)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageUsers(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Deleting a member cascades across payments, attendance and authored
    // content. Irreversible, so it takes a 2FA-verified session.
    const stepUp = requireStepUp(session)
    if (stepUp) return stepUp

    const { id } = await params
    if (id === session.id) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })

    const target = await prisma.user.findUnique({ where: { id }, select: { name: true, email: true, cityId: true } })

    // P1 fix: snapshot every payment row + write a per-payment
    // "deletion" PaymentLog before the user.delete cascade vaporises
    // them. Previously a single user-delete blew away all of that
    // user's payment history with no financial trail at all — the
    // PR 1 audit work on the admin payments page was undermined here
    // because there was no per-payment record left to query.
    //
    // PaymentLog has no FK relation in the schema, so the rows
    // survive the cascade and remain queryable by paymentId. The
    // global audit row aggregates the financial impact so the
    // user-removal event in the audit log self-documents.
    const payments = await prisma.payment.findMany({
      where:  { userId: id },
      select: { id: true, amount: true, currency: true, status: true, eventId: true, createdAt: true },
    })

    // Approved club memberships are about to be deleted in the cascade —
    // decrement each club's memberCount in the same transaction so the
    // cached counts don't drift high (root cause of recount problems).
    const approvedClubs = await prisma.clubMembership.findMany({
      where:  { userId: id, status: 'approved' },
      select: { clubId: true },
    })

    // Post.authorId and Newsletter.sentById are required Restrict FKs, so
    // the delete threw P2003 for exactly the accounts most likely to be
    // removed — ex-staff who authored handbook posts or sent newsletters.
    // Reassign authorship to the house admin account (oldest admin, the
    // same account the auto-digest attributes to). Event.hostId is a bare
    // string with no FK, so without the same reassignment a deleted host's
    // events pointed at a nonexistent user forever.
    const [authoredPosts, sentNewsletters, hostedEvents] = await Promise.all([
      prisma.post.count({ where: { authorId: id } }),
      prisma.newsletter.count({ where: { sentById: id } }),
      prisma.event.count({ where: { hostId: id } }),
    ])
    let houseAdminId: string | null = null
    if (authoredPosts > 0 || sentNewsletters > 0 || hostedEvents > 0) {
      const houseAdmin = await prisma.user.findFirst({
        where:   { role: 'admin', id: { not: id } },
        orderBy: { joinedAt: 'asc' },
        select:  { id: true },
      })
      if (!houseAdmin) {
        return NextResponse.json(
          { error: 'This account authored posts, newsletters or events and no other admin exists to inherit them.' },
          { status: 400 },
        )
      }
      houseAdminId = houseAdmin.id
    }

    // Same drift problem for events: the eventAttendee.deleteMany below
    // removes rows that back the cached Event.spotsLeft counter (it was
    // decremented when the user joined), so upcoming events would keep
    // phantom "going" counts forever (seen in prod: spotsLeft 6/8 with
    // zero attendee rows). Snapshot the affected upcoming events now and
    // recompute after the delete. Past events stay untouched — their
    // spotsLeft is the historical attendance record.
    const upcomingAttending = await prisma.eventAttendee.findMany({
      where: {
        userId: id,
        status: 'approved',
        event:  { status: 'published', date: { gte: await todayInCity(await resolveCityId(session)) } },
      },
      select: { eventId: true, event: { select: { totalSpots: true } } },
    })

    // PaymentLog inserts live inside the $transaction so they roll
    // back together with the cascade if any step fails — admin
    // retrying after a partial failure won't see ghost "deleted"
    // log entries pointing at payments that are actually still
    // present. Spread conditionally so the array stays empty when
    // there are no payments to record.
    // Reports, no-show cards and admin notes cascade with the row; keep them.
    const retained = await snapshotUserHistory(id)
    await prisma.$transaction([
      ...(payments.length > 0 ? [
        prisma.paymentLog.createMany({
          data: payments.map(p => ({
            paymentId:  p.id,
            adminId:    session.id,
            adminName:  session.name,
            fromStatus: p.status,
            toStatus:   'deleted',
            note:       `Payment deleted as part of user removal (${p.amount} ${p.currency}, was ${p.status})`,
          })),
        }),
      ] : []),
      ...approvedClubs.map(m =>
        prisma.club.update({ where: { id: m.clubId }, data: { memberCount: { decrement: 1 } } })
      ),
      prisma.eventAttendee.deleteMany({ where: { userId: id } }),
      prisma.clubMembership.deleteMany({ where: { userId: id } }),
      prisma.notification.deleteMany({ where: { userId: id } }),
      prisma.notificationPreference.deleteMany({ where: { userId: id } }),
      prisma.review.deleteMany({ where: { userId: id } }),
      prisma.payment.deleteMany({ where: { userId: id } }),
      prisma.eventMessage.deleteMany({ where: { userId: id } }),
      prisma.report.deleteMany({ where: { OR: [{ reporterId: id }, { reportedId: id }] } }),
      prisma.waitlistEntry.deleteMany({ where: { userId: id } }),
      prisma.emailVerificationToken.deleteMany({ where: { userId: id } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
      ...(houseAdminId ? [
        prisma.post.updateMany({ where: { authorId: id }, data: { authorId: houseAdminId } }),
        prisma.newsletter.updateMany({ where: { sentById: id }, data: { sentById: houseAdminId } }),
        prisma.event.updateMany({ where: { hostId: id }, data: { hostId: houseAdminId } }),
      ] : []),
      prisma.user.delete({ where: { id } }),
    ])

    // Re-derive spotsLeft for each upcoming event the user was approved
    // on, now that their attendee rows are gone. recomputeSpotsLeft counts
    // the remaining approved rows (host/co-hosts excluded), so this also
    // clamps any pre-existing drift instead of blindly incrementing.
    // Fail-soft: the user is already deleted, and the nightly
    // sweep-event-spots reconciliation covers any recompute that dies here.
    for (const a of upcomingAttending) {
      await recomputeSpotsLeft(a.eventId, a.event.totalSpots).catch(e =>
        console.error('[user.remove] spotsLeft recompute failed', { eventId: a.eventId, error: String(e) })
      )
    }

    // Roll the payment impact into the user.remove audit entry so the
    // audit log row is self-documenting (no need to cross-reference
    // payment_logs to know what was lost).
    const paymentSummary = payments.length === 0 ? null : {
      count:       payments.length,
      totalAmount: payments.reduce((s, p) => s + p.amount, 0),
      byStatus:    payments.reduce<Record<string, number>>((acc, p) => {
        acc[p.status] = (acc[p.status] ?? 0) + 1
        return acc
      }, {}),
      ids:         payments.map(p => p.id),
    }
    // cityId from the snapshot: the user row is gone, so the audit lookup
    // can't resolve their home city.
    writeAudit(session.id, session.name, 'user.remove', id, 'user',
      { name: target?.name, email: target?.email, cityId: target?.cityId ?? null, payments: paymentSummary, retained },
      `User ${target?.name ?? id} (${target?.email ?? ''}) permanently removed${
        paymentSummary ? ` — ${paymentSummary.count} payment${paymentSummary.count === 1 ? '' : 's'} destroyed (${formatMoney(paymentSummary.totalAmount, payments[0]?.currency)} across ${Object.entries(paymentSummary.byStatus).map(([s, n]) => `${n} ${s}`).join(', ')})` : ''
      }`,
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
