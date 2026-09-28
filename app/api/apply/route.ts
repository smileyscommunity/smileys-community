import { NextRequest, NextResponse } from 'next/server'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/constants'
import { sendApplicationReceivedEmail, sendAdminNewApplicationEmail, sendAlreadyRegisteredEmail, sendApplicationOnFileEmail, recordEmailFailure } from '@/lib/email'
import { randomBytes } from 'crypto'
import { APP_URL } from '@/lib/env'
import { INTEREST_VALUES } from '@/lib/profileOptions'
import { GENDERS } from '@/lib/profileFields'
import { SOCIAL_STYLES } from '@/lib/socialStyles'
import { canonicalEmail, canonicalPhone, isValidTimeZone, ageOn } from '@/lib/applicantIdentity'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { notifyCityStaff } from '@/lib/staffNotify'
import { LOOKING_FOR_VALUES } from '@/lib/profileOptions'
import { verifyTurnstile } from '@/lib/turnstile'
import { areApplicationsOpen, newApplicationEmailsEnabled } from '@/lib/communitySettings'
import { formatName } from '@/lib/data'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const disposableDomains: string[] = require('disposable-email-domains')

// Applicant photos live in the applications/ folder (their own upload
// route); that folder is admin-gated at serve time and excluded from the
// shared validator's public default, so it's named explicitly here.
import { utimesSync } from 'fs'
import { join } from 'path'
import { uploadRoot } from '@/lib/uploadRoot'

const applySchema = z.object({
  firstName:   z.string().trim().min(1).max(100),
  lastName:    z.string().trim().min(1).max(100),
  email:       z.string().trim().email().max(320),
  phone:       z.string().trim().min(1).max(30),
  country:     z.string().trim().min(1).max(100),
  // Required only where the city has neighbourhoods on file (checked below):
  // Athens and Sofia have none, and the form can't offer an empty list.
  neighborhood:z.string().trim().max(200).optional().nullable(),
  gender:      z.string().trim().min(1).max(50),
  profilePhoto:z.string().trim().refine(v => isUploadedImageUrl(v, ['applications']), 'Invalid profile photo'),
  // Optional fields
  birthdate:       z.string().trim().max(20).optional().nullable(),
  city:            z.string().trim().max(100).optional().nullable(),
  instagram:       z.string().trim().max(100).optional().nullable(),
  linkedin:        z.string().trim().max(200).optional().nullable(),
  profession:      z.string().trim().max(200).optional().nullable(),
  timeInCity:      z.string().trim().max(500).optional().nullable(),
  reasonHere:      z.string().trim().max(1000).optional().nullable(),
  aboutCommunity:  z.string().trim().max(2000).optional().nullable(),
  socialJudgment:  z.string().trim().max(2000).optional().nullable(),
  bio:             z.string().trim().max(1000).optional().nullable(),
  source:          z.string().trim().max(200).optional().nullable(),
  referredBy:      z.string().trim().max(20).optional().nullable(),
  targetCitySlug:  z.string().trim().max(80).optional().nullable(),
  languages:       z.array(z.string().max(50)).max(20).optional().default([]),
  interests:       z.array(z.string().max(50)).max(30).optional().default([]),
  socialStyles:    z.array(z.string().max(50)).max(20).optional().default([]),
  lookingFor:      z.array(z.string().max(50)).max(10).optional().default([]),
  referrerName:    z.string().trim().max(100).optional().nullable(),
  // "I don't live here (yet)" — a visitor, or someone still moving, has no
  // neighbourhood to pick and used to have to invent one.
  notResident:     z.boolean().optional().default(false),
  // The one box that matters legally: Terms + Privacy + 18 or older.
  termsAccepted:   z.boolean().refine(v => v === true, 'Please accept the Terms of Service and Privacy Policy'),
  // Unticked by default — a choice, not a default (GDPR).
  emailMarketing:  z.boolean().optional().default(false),
  openToCoffee:    z.boolean().optional().default(false),
  openToLanguage:  z.boolean().optional().default(false),
  openToHosting:   z.boolean().optional().default(false),
  // Legacy essay fields — still accepted so old clients / drafts don't break
  whyJoin:              z.string().trim().max(2000).optional().nullable(),
  enjoyWith:            z.string().trim().max(2000).optional().nullable(),
  goodCommunity:        z.string().trim().max(2000).optional().nullable(),
  contribution:         z.string().trim().max(2000).optional().nullable(),
  groupBehavior:        z.string().trim().max(2000).optional().nullable(),
  removedFromCommunity: z.string().trim().max(2000).optional().nullable(),
  toxicBehavior:        z.string().trim().max(2000).optional().nullable(),
  // Anti-fraud / internal fields
  _hp: z.any().optional(),  // honeypot
  _cf: z.string().optional().nullable(),  // Cloudflare Turnstile token
  _fp: z.string().max(64).optional().nullable(),  // fingerprint
  _tz: z.string().max(60).optional().nullable(),  // browser timezone
})

function nameDistance(a: string, b: string): number {
  // Simple normalized edit distance for name similarity
  const s = a.toLowerCase().replace(/[^a-z]/g, '')
  const t = b.toLowerCase().replace(/[^a-z]/g, '')
  if (!s || !t) return 1
  if (s === t) return 0
  const m = s.length, n = t.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = s[i-1] === t[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n] / Math.max(m, n)
}

// Refusals end with a way to reach a person: every one of them used to be a
// dead end ("This application cannot be accepted." and nothing else).
const CONTACT = 'If you think this is a mistake, write to info@smileyscommunity.com.'
// One sentence and one status (409) for every refusal — blacklist, duplicate
// and cooldown alike. A 403 for the blacklist beside a 409 for a recent
// rejection let anyone who typed a stranger's phone number learn which of the
// two that person was. Neutral, because the screen can't know whose details
// these are; the inbox owner is told the rest by email where it applies.
const REFUSED = `We can't take a new application with these details right now. If you've applied before, check your inbox. ${CONTACT}`
const SOCIAL_STYLE_IDS = new Set<string>(SOCIAL_STYLES.map(st => st.id))
const CONTRIBUTIONS = new Set(['attend', 'organize', 'host'])

// A schema failure names the field in words — the raw message ("Too small:
// expected string to have >=1 characters") said nothing an applicant could fix.
const FIELD_LABEL: Record<string, string> = {
  firstName: 'first name', lastName: 'last name', email: 'email address', phone: 'phone number',
  country: 'nationality', neighborhood: 'neighbourhood', gender: 'gender', profilePhoto: 'photo',
  birthdate: 'date of birth', termsAccepted: 'terms',
}

export async function POST(req: NextRequest) {
  try {
    // Membership intake can be paused from /admin/settings.
    if (!areApplicationsOpen()) {
      return NextResponse.json({ error: 'Applications are currently closed. Please check back soon.' }, { status: 403 })
    }
    const raw = await req.json().catch(() => null)
    const parsed = applySchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue ? FIELD_LABEL[String(issue.path[0])] : undefined
      // The terms refinement carries its own sentence; everything else is
      // named by field.
      const msg = issue?.path[0] === 'termsAccepted' ? issue.message
        : field ? `Please check your ${field}.` : 'Something in the form needs another look.'
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const {
      firstName, lastName, email, phone, birthdate, gender, country, city, neighborhood,
      profession, timeInCity, reasonHere,
      aboutCommunity, languages, interests, socialStyles, lookingFor, referrerName, emailMarketing,
      openToCoffee, openToLanguage, openToHosting, notResident,
      contribution,
      profilePhoto, targetCitySlug, source, referredBy,
      _hp, _cf, _fp, _tz,
    } = parsed.data

    if (!(await verifyTurnstile(_cf ?? '', getIp(req)))) {
      return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
    }

    // 3 applications per hour per IP — counted only once the request is real
    // (verified and well-formed). It was spent before either check, so three
    // junk POSTs from anyone on a shared network locked everyone on it out
    // for an hour, and an applicant's own failed attempts used it up.
    if (!await rateLimit(`apply:${getIp(req)}`, 3, 60 * 60_000)) {
      return NextResponse.json({ error: `Too many applications from this network in the last hour. Please try again later. ${CONTACT}` }, { status: 429 })
    }

    if (_hp) return NextResponse.json({ ok: true })

    // The photo link must still point at a file. Unreferenced applications/
    // uploads are reaped after 48 hours (cron sweep-orphan-uploads), and an
    // applicant returning to an old browser draft could otherwise submit a link
    // to a photo that no longer exists — an application reviewers can't judge.
    // Refreshing its mtime doubles as the existence check (it throws on a
    // missing file) and claims the photo: the reaper re-checks a file's age
    // immediately before deleting it, so a photo being submitted right now is
    // skipped even if this application's row isn't written yet.
    const photoFile = profilePhoto.split('/applications/')[1] ?? ''
    let photoPresent = false
    if (photoFile && !photoFile.includes('/') && !photoFile.includes('..')) {
      try {
        const now = new Date()
        utimesSync(join(uploadRoot(), 'applications', photoFile), now, now)
        photoPresent = true
      } catch { photoPresent = false }
    }
    if (!photoPresent) {
      return NextResponse.json({ error: 'Your photo upload has expired. Please upload your photo again.' }, { status: 400 })
    }

    // Resolve the target city from the slug the form posted (or
    // Istanbul if the client didn't send one — older builds). Reject
    // applications to paused cities at the door.
    const wantedSlug = targetCitySlug?.trim() || 'istanbul'
    const targetCity = await prisma.city.findUnique({
      where: { slug: wantedSlug },
      select: { id: true, status: true, name: true },
    })
    if (!targetCity || targetCity.status === 'paused') {
      return NextResponse.json({ error: `Applications to "${wantedSlug}" aren't open right now.` }, { status: 400 })
    }
    const targetCityId = targetCity.id
    // The neighbourhood must be one of the city's own (a draft for another
    // city sent an Istanbul name to İzmir); required where the city has any,
    // unless the applicant doesn't live there yet.
    const cityHoods = await prisma.neighborhood.findMany({ where: { cityId: targetCityId, active: true }, select: { name: true } })
    const cleanNeighborhood = notResident ? null : (neighborhood?.trim() || null)
    if (cleanNeighborhood && !cityHoods.some(h => h.name === cleanNeighborhood)) {
      return NextResponse.json({ error: 'Please check your neighbourhood.' }, { status: 400 })
    }
    if (!cleanNeighborhood && !notResident && cityHoods.length > 0) {
      return NextResponse.json({ error: 'Please check your neighbourhood.' }, { status: 400 })
    }
    // The form's closed lists, checked here too — approval copies them onto
    // the member's profile, so a hand-made request could set anything.
    if (!(GENDERS as readonly string[]).includes(gender)) {
      return NextResponse.json({ error: 'Please check your gender.' }, { status: 400 })
    }
    const age = ageOn(birthdate)
    if (age !== null && age < 18) {
      return NextResponse.json({ error: 'Smileys is for adults — you need to be 18 or older to apply.' }, { status: 400 })
    }

    // Normalise on the way in, like every other write path does
    // (auth/register, auth/me, admin/users/[id]). This one didn't, and it is
    // the route nearly every member actually joins through — so a name typed
    // "h.kubra yilmaz" was stored exactly that way and shown that way until
    // the nightly hygiene sweep got to it, if it ever did.
    const cleanFirst  = formatName(firstName)
    const cleanLast   = formatName(lastName)
    const fullName    = `${cleanFirst} ${cleanLast}`
    const cleanEmail  = email.toLowerCase()
    const cleanPhone  = phone || null
    const cleanRef    = referredBy?.trim() || null
    // Only a member in good standing refers: a suspended or hidden member's
    // code no longer credits them (their chip is withheld on the form too).
    const refOwner    = cleanRef && /^[A-Z2-9]{8}$/.test(cleanRef)
      ? await prisma.user.findUnique({ where: { referralCode: cleanRef }, select: { status: true, hiddenFromMembers: true, suspendedUntil: true } })
      : null
    const validRef    = refOwner && refOwner.status === 'approved' && !refOwner.hiddenFromMembers
      && !(refOwner.suspendedUntil && refOwner.suspendedUntil > new Date()) ? cleanRef : null
    // What the checks compare (lib/applicantIdentity): spacing, a +tag or
    // Gmail's dots no longer walk past the blacklist and the cooldowns.
    const idEmail = canonicalEmail(cleanEmail)
    const idPhone = canonicalPhone(cleanPhone)

    // Blacklist check — email, phone, fingerprint, IP
    // Filter out null/empty values — an empty {} in Prisma OR matches ALL records,
    // which would block every applicant whenever any blacklist entry exists.
    // Trusted IP only (Nginx x-real-ip / last XFF hop, normalised) — the raw
    // first XFF entry is client-spoofable, which would let a blacklisted or
    // rate-limited applicant forge a fresh IP to evade the velocity/blacklist/
    // cooldown checks below (all keyed on this value). Also validated, so it's
    // safe to store and compare.
    const trustedIp = getIp(req)
    const ip = trustedIp === 'unknown' ? null : trustedIp
    const fingerprint = typeof _fp === 'string' && _fp.length > 0 ? _fp.slice(0, 64) : null
    // A blacklisted EMAIL or PHONE is the person; a blacklisted DEVICE
    // fingerprint or NETWORK address is not — the free fingerprint collides
    // across ordinary browsers (see below) and one address covers a campus, a
    // coworking or a mobile carrier. Those two flag the application for the
    // reviewer instead of refusing whoever happens to share them.
    const deviceConditions = [
      fingerprint ? { fingerprint }         : null,
      ip          ? { ipAddress: ip }       : null,
    ].filter(Boolean) as object[]
    // The blacklist is small: read its identities and compare canonical forms.
    const [blacklistIds, blacklistedDevice] = await Promise.all([
      prisma.blacklist.findMany({ where: { OR: [{ email: { not: null } }, { phone: { not: null } }] }, select: { email: true, phone: true } }),
      deviceConditions.length > 0 ? prisma.blacklist.findFirst({ where: { OR: deviceConditions }, select: { id: true } }) : Promise.resolve(null),
    ])
    const blacklisted = blacklistIds.some(b =>
      (idEmail && canonicalEmail(b.email) === idEmail) || (idPhone && canonicalPhone(b.phone) === idPhone))
    if (blacklisted) {
      return NextResponse.json({ error: REFUSED }, { status: 409 })
    }

    // Duplicate / rejected applicant checks — use generic message to prevent enumeration.
    // Policy: rejection is a 90-day cooldown, not a lifetime ban. Pending and
    // approved applications always block a duplicate; rejected ones only block
    // inside the cooldown window (velocity auto-rejects have reviewedAt null,
    // so age those by createdAt instead).
    const cooldownDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const [emailApps, recentRejected] = await Promise.all([
      prisma.memberApplication.findMany({
        where: { email: cleanEmail },
        select: { status: true, emailConfirmedAt: true, fullName: true },
      }),
      // Rejections inside the cooldown, compared by canonical email / phone /
      // Instagram below. Only CONFIRMED ones: an application someone else made
      // with this email or phone was never this person's (double opt-in). A
      // network auto-reject (the old velocity rule) was never a decision
      // about anyone and doesn't count either.
      prisma.memberApplication.findMany({
        where: {
          status: 'rejected', emailConfirmedAt: { not: null },
          NOT: { reviewNote: { startsWith: 'Auto-rejected: velocity' } },
          OR: [{ reviewedAt: { gte: cooldownDate } }, { reviewedAt: null, createdAt: { gte: cooldownDate } }],
        },
        select: { email: true, phone: true, instagram: true },
      }),
    ])
    // A live application on this email blocks a second one — once its email
    // is confirmed (or it was approved). An unconfirmed one may be someone
    // else's claim on the address; it must not lock the real owner out.
    const liveApp = emailApps.find(a => a.status !== 'rejected' && (a.emailConfirmedAt || a.status === 'approved'))
    const emailBlocked = !!liveApp
    if (emailBlocked) {
      // When the block is because this email already belongs to an APPROVED
      // member, the on-screen message stays generic (no enumeration for
      // whoever typed the email), but the inbox owner gets told the truth:
      // you have an account — sign in / reset your password. Fixes the
      // "approved months ago, forgot, re-applies, hits a dead end" loop
      // that otherwise lands in the WhatsApp groups as a support question.
      // Rate-limited per email so the apply form can't be used to bomb a
      // member's inbox.
      const existingUser = await prisma.user.findUnique({
        where:  { email: cleanEmail },
        select: { name: true, status: true },
      })
      if (existingUser?.status === 'approved'
          && await rateLimit(`apply-already-member:${cleanEmail}`, 1, 24 * 60 * 60_000)) {
        sendAlreadyRegisteredEmail(cleanEmail, existingUser.name).catch(() => {})
      } else if (liveApp?.status !== 'approved'
          && await rateLimit(`apply-on-file:${cleanEmail}`, 1, 24 * 60 * 60_000)) {
        // Still being reviewed: a retry (a dropped connection after the save,
        // a second try from another device) used to read as a rejection.
        sendApplicationOnFileEmail(cleanEmail, liveApp?.fullName ?? cleanFirst).catch(() => {})
      }
      return NextResponse.json({ error: REFUSED }, { status: 409 })
    }

    // 90-day cooldown after rejection — by phone only. By IP it refused
    // everyone behind the same address (a campus, a coworking, a carrier's
    // NAT) for 90 days after one person there was turned down.
    // Build OR conditions, filtering out nulls to avoid Prisma empty-object
    // matching all records when a field isn't provided.
    // Fingerprint intentionally excluded from cooldown: non-unique on the free
    // FingerprintJS tier, so including it causes innocent applicants sharing a
    // browser config with a rejected person to be blocked.
    const recentRejection = recentRejected.some(r =>
      (idEmail && canonicalEmail(r.email) === idEmail) || (idPhone && canonicalPhone(r.phone) === idPhone))
    if (recentRejection) {
      return NextResponse.json({ error: REFUSED }, { status: 409 })
    }

    // An IANA name or nothing: it arrives as free text and reaches staff views.
    const browserTz    = isValidTimeZone(_tz) ? _tz : null

    // Disposable email check
    const emailDomain     = cleanEmail.split('@')[1] ?? ''
    const isDisposable    = disposableDomains.includes(emailDomain)

    // No IP geolocation: the timezone check sent every applicant's address to
    // a third party over plain HTTP for a weak VPN signal. The browser's
    // timezone is still stored for the reviewer; the mismatch flag stays off.
    const timezoneMismatch = false

    // IP velocity — auto-reject if 3+ applications from same IP in 24h.
    // Fingerprint is intentionally excluded: the free FingerprintJS tier
    // produces non-unique IDs for commonly configured browsers (same Chrome
    // version + OS + screen size) which caused innocent applicants to be
    // auto-rejected. IP-only is less precise but has far fewer false positives.
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const ipCount = ip
      ? await prisma.memberApplication.count({ where: { ipAddress: ip, createdAt: { gte: since24h } } })
      : 0
    // Several applications from one network in a day is a signal for the
    // reviewer, not a verdict: friends applying together on venue Wi-Fi, a
    // class on campus Wi-Fi and a carrier's shared address all look like
    // this. It auto-rejected the fourth applicant — and, through the email
    // check above, locked their email for 90 days.
    const manyFromNetwork = ipCount >= 3

    // Similar name check against blacklist
    const blacklistNames = await prisma.blacklist.findMany({ select: { name: true } })
    const nameSimilar = blacklistNames.some(b => b.name && nameDistance(fullName, b.name) < 0.35)

    // Staff of the city applied to — every admin, and that city's moderators
    // (lib/staffNotify). It used to be every moderator everywhere, so a
    // Bursa moderator got an Istanbul applicant's name, sometimes a second
    // member's name, and the device/timezone signals behind a queue they
    // can't even open.

    // Check if fingerprint or IP matches a REJECTED application — alert admins.
    // Only match rejected (not approved/hold) — approved members sharing a
    // fingerprint is a FingerprintJS false positive (same browser config),
    // not a security signal.
    const [fpMatch, ipMatch] = await Promise.all([
      fingerprint ? prisma.memberApplication.findFirst({ where: { fingerprint, status: 'rejected' }, select: { id: true } }) : Promise.resolve(null),
      ip          ? prisma.memberApplication.findFirst({ where: { ipAddress: ip, status: 'rejected' }, select: { id: true } }) : Promise.resolve(null),
    ])

    // Aggregate suspicion score — single dimension admins can sort by. Each
    // signal contributes a weight; admins can later tune via constants. Score
    // 0-1 = normal, 2-3 = worth a glance, 4+ = high-suspicion (admin push
    // gets stronger language).
    let suspicionScore = 0
    if (timezoneMismatch) suspicionScore += 1   // possible VPN
    if (manyFromNetwork)  suspicionScore += 2   // 3+ applications from this network today
    if (blacklistedDevice) suspicionScore += 2  // a blacklisted device or network
    if (isDisposable)     suspicionScore += 2   // temp/throwaway email
    if (nameSimilar)      suspicionScore += 2   // close to a blacklist name
    if (fpMatch)          suspicionScore += 1   // fingerprint hit on prior decision
    if (ipMatch)          suspicionScore += 1   // IP hit on prior rejection
    if (!cleanPhone)      suspicionScore += 1   // no phone provided

    const confirmToken = randomBytes(24).toString('hex')
    await prisma.memberApplication.create({
      data: {
        firstName: cleanFirst, lastName: cleanLast, fullName,
        emailConfirmedAt: null,
        confirmToken,
        email:       cleanEmail,
        phone:       cleanPhone,
        birthdate:   birthdate  || null,
        gender:      gender     || null,
        country:     country    || null,
        // The applicant's target city name, not a hardcoded 'Istanbul' — a
        // Berlin applicant was stored with targetCityId=Berlin but city="Istanbul",
        // mislabeling them in every admin view/export that reads the string.
        city:        targetCity.name,
        neighborhood: cleanNeighborhood,
        // Instagram, LinkedIn, bio and the old essays are no longer on the
        // form; the API accepted and stored them anyway, and a LinkedIn value
        // rendered as a link on the review screen. Accepted (old drafts don't
        // break) and dropped.
        profession,  timeInCity, reasonHere,
        interests:    interests.filter(v => INTEREST_VALUES.has(v)),
        socialStyles: socialStyles.filter(v => SOCIAL_STYLE_IDS.has(v)).slice(0, 3),
        languages,
        // Only the profile's own options, whatever the client sent.
        lookingFor:   lookingFor.filter(v => LOOKING_FOR_VALUES.has(v)),
        referrerName: source === 'friend' ? (referrerName?.trim() || null) : null,
        termsAcceptedAt: new Date(),
        emailMarketing,
        contribution: contribution && CONTRIBUTIONS.has(contribution) ? contribution : null,
        aboutCommunity,
        openToCoffee, openToLanguage, openToHosting,
        profilePhoto: profilePhoto || null,
        assignedClubs: [],
        source,
        referredBy:           validRef,
        ipAddress:            ip,
        userAgent:            req.headers.get('user-agent')?.slice(0, 500) || null,
        fingerprint,
        timezone:             browserTz,
        timezoneMismatch,
        disposableEmail:      isDisposable,
        suspicionScore,
        targetCityId,
      },
    })

    // Notify admins — push alert for suspicious signals, standard in-app for normal
    const flags: string[] = []
    // No other applicant's name: this goes to the target city's moderators as
    // a push, and named a rejected applicant from any city they can't open.
    if (fpMatch || ipMatch) flags.push('device or network matches a previously rejected application')
    if (manyFromNetwork)   flags.push(`${ipCount + 1} applications from this network today`)
    if (blacklistedDevice) flags.push('device or network on the blacklist')
    if (isDisposable)      flags.push('disposable email')
    if (nameSimilar)       flags.push('name similar to a blacklisted person')

    const isSuspicious = flags.length > 0
    const notifTitle   = isSuspicious ? '⚠️ Suspicious application' : 'New application 📋'
    const notifBody    = isSuspicious
      ? `${fullName.trim()} — ${flags.join(' · ')}`
      : `${fullName.trim()} has applied to join Smileys.`

    await notifyCityStaff(targetCityId, 'application', notifTitle, notifBody, '/admin/applications')

    Promise.all([
      sendApplicationReceivedEmail(cleanEmail, fullName.trim(), `${APP_URL}/api/apply/confirm?token=${confirmToken}`, targetCity.name, targetCity.status === 'live'),
      // Admin new-application email respects the mute toggle — but suspicious
      // applications always email (a security signal you can't silence).
      ...(newApplicationEmailsEnabled() || isSuspicious ? [sendAdminNewApplicationEmail(fullName.trim(), cleanEmail)] : []),
    ]).catch(async e => {
      console.error('Apply email error:', e)
      await recordEmailFailure({ helper: 'sendApplicationReceivedEmail', recipient: cleanEmail, error: e })
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
