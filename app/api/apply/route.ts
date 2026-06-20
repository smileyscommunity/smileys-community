import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { Role } from '@/lib/constants'
import { sendApplicationReceivedEmail, sendAdminNewApplicationEmail } from '@/lib/email'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { verifyTurnstile } from '@/lib/turnstile'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const disposableDomains: string[] = require('disposable-email-domains')

const PHOTO_RE = /^\/app\/api\/files\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+\.(jpg|jpeg|png|webp|gif)$/

const applySchema = z.object({
  firstName:   z.string().trim().min(1).max(100),
  lastName:    z.string().trim().min(1).max(100),
  email:       z.string().trim().email().max(320),
  phone:       z.string().trim().min(1).max(30),
  country:     z.string().trim().min(1).max(100),
  neighborhood:z.string().trim().min(1).max(200),
  gender:      z.string().trim().min(1).max(50),
  profilePhoto:z.string().trim().regex(PHOTO_RE, 'Invalid profile photo'),
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

async function getIpTimezone(ip: string): Promise<string | null> {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=timezone`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const data = await res.json()
    return data.timezone ?? null
  } catch { return null }
}

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

export async function POST(req: NextRequest) {
  try {
    // 3 applications per hour per IP
    if (!await rateLimit(`apply:${getIp(req)}`, 3, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many applications from this IP. Try again later.' }, { status: 429 })
    }

    const raw = await req.json().catch(() => null)
    const parsed = applySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }
    const {
      firstName, lastName, email, phone, birthdate, gender, country, city, neighborhood,
      instagram, linkedin, profession, timeInCity, reasonHere,
      aboutCommunity, socialJudgment, languages, interests, socialStyles,
      openToCoffee, openToLanguage, openToHosting,
      whyJoin, enjoyWith, goodCommunity,
      contribution, groupBehavior, removedFromCommunity, toxicBehavior,
      profilePhoto, targetCitySlug, bio, source, referredBy,
      _hp, _cf, _fp, _tz,
    } = parsed.data

    if (!(await verifyTurnstile(_cf ?? '', getIp(req)))) {
      return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
    }

    if (_hp) return NextResponse.json({ ok: true })

    // Resolve the target city from the slug the form posted (or
    // Istanbul if the client didn't send one — older builds). Reject
    // applications to paused cities at the door.
    const wantedSlug = targetCitySlug?.trim() || 'istanbul'
    const targetCity = await prisma.city.findUnique({
      where: { slug: wantedSlug },
      select: { id: true, status: true },
    })
    if (!targetCity || targetCity.status === 'paused') {
      return NextResponse.json({ error: `Applications to "${wantedSlug}" aren't open right now.` }, { status: 400 })
    }
    const targetCityId = targetCity.id

    const fullName    = `${firstName} ${lastName}`
    const cleanEmail  = email.toLowerCase()
    const cleanPhone  = phone || null
    const cleanInstagram = instagram?.trim() || null
    const cleanRef    = referredBy?.trim() || null
    const validRef    = cleanRef && /^[A-Z2-9]{8}$/.test(cleanRef) ? cleanRef : null

    // Blacklist check — email, phone, fingerprint, IP
    // Filter out null/empty values — an empty {} in Prisma OR matches ALL records,
    // which would block every applicant whenever any blacklist entry exists.
    const ip = (req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '').split(',')[0].trim() || null
    const fingerprint = typeof _fp === 'string' && _fp.length > 0 ? _fp.slice(0, 64) : null
    const blacklistConditions = [
      cleanEmail  ? { email: cleanEmail }   : null,
      cleanPhone  ? { phone: cleanPhone }   : null,
      fingerprint ? { fingerprint }         : null,
      ip          ? { ipAddress: ip }       : null,
    ].filter(Boolean) as object[]
    const blacklisted = blacklistConditions.length > 0
      ? await prisma.blacklist.findFirst({ where: { OR: blacklistConditions } })
      : null
    if (blacklisted) {
      return NextResponse.json({ error: 'This application cannot be accepted.' }, { status: 403 })
    }

    // Duplicate / rejected applicant checks — use generic message to prevent enumeration
    const existingEmail = await prisma.memberApplication.findFirst({ where: { email: cleanEmail } })
    if (existingEmail) {
      return NextResponse.json({ error: 'This application cannot be accepted.' }, { status: 409 })
    }

    // 90-day cooldown after rejection (phone, fingerprint, or IP)
    const cooldownDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    // Build OR conditions, filtering out nulls to avoid Prisma empty-object
    // matching all records when a field isn't provided.
    // Fingerprint intentionally excluded from cooldown: non-unique on the free
    // FingerprintJS tier, so including it causes innocent applicants sharing a
    // browser config with a rejected person to be blocked.
    const cooldownConditions = [
      cleanPhone ? { phone: cleanPhone } : null,
      ip         ? { ipAddress: ip }     : null,
    ].filter(Boolean) as object[]
    const recentRejection = cooldownConditions.length > 0
      ? await prisma.memberApplication.findFirst({
          where: { status: 'rejected', reviewedAt: { gte: cooldownDate }, OR: cooldownConditions },
        })
      : null
    if (recentRejection) {
      return NextResponse.json({ error: 'This application cannot be accepted.' }, { status: 409 })
    }

    if (cleanPhone) {
      const phoneMatch = await prisma.memberApplication.findFirst({
        where: { phone: cleanPhone, status: 'rejected' },
      })
      if (phoneMatch) {
        return NextResponse.json({ error: 'This application cannot be accepted.' }, { status: 409 })
      }
    }

    if (cleanInstagram) {
      const igMatch = await prisma.memberApplication.findFirst({
        where: { instagram: cleanInstagram, status: 'rejected' },
      })
      if (igMatch) {
        return NextResponse.json({ error: 'This application cannot be accepted.' }, { status: 409 })
      }
    }

    const browserTz    = typeof _tz === 'string' ? _tz.slice(0, 60) : null

    // Disposable email check
    const emailDomain     = cleanEmail.split('@')[1] ?? ''
    const isDisposable    = disposableDomains.includes(emailDomain)

    // Timezone mismatch check
    const ipTimezone      = ip ? await getIpTimezone(ip) : null
    const timezoneMismatch = !!(browserTz && ipTimezone && browserTz !== ipTimezone)

    // IP velocity — auto-reject if 3+ applications from same IP in 24h.
    // Fingerprint is intentionally excluded: the free FingerprintJS tier
    // produces non-unique IDs for commonly configured browsers (same Chrome
    // version + OS + screen size) which caused innocent applicants to be
    // auto-rejected. IP-only is less precise but has far fewer false positives.
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const ipCount = ip
      ? await prisma.memberApplication.count({ where: { ipAddress: ip, createdAt: { gte: since24h } } })
      : 0
    const velocityBlock = ipCount >= 3

    // Similar name check against blacklist
    const blacklistNames = await prisma.blacklist.findMany({ select: { name: true } })
    const nameSimilar = blacklistNames.some(b => b.name && nameDistance(fullName, b.name) < 0.35)

    // Notify admins if known device/IP or suspicious signals
    const admins = await prisma.user.findMany({ where: { role: { in: [Role.Admin, Role.Moderator] } }, select: { id: true } })

    if (velocityBlock) {
      // Still save but mark as rejected immediately
      await prisma.memberApplication.create({
        data: {
          firstName, lastName, fullName,
          email: cleanEmail, phone: cleanPhone, ipAddress: ip, userAgent: req.headers.get('user-agent')?.slice(0, 500) || null,
          fingerprint, timezone: browserTz, timezoneMismatch, disposableEmail: isDisposable,
          status: 'rejected', reviewNote: 'Auto-rejected: velocity limit (3+ applications from same IP within 24h)',
          assignedClubs: [], interests: [], socialStyles: [],
          targetCityId,
        },
      })
      admins.forEach(a => createNotification(a.id, 'application', '⚠️ Velocity block triggered',
        `${fullName} was auto-rejected — same IP applied 3+ times in 24h`, '/admin/applications').catch(() => {}))
      return NextResponse.json({ error: 'This application cannot be accepted.' }, { status: 403 })
    }

    // Check if fingerprint or IP matches a REJECTED application — alert admins.
    // Only match rejected (not approved/hold) — approved members sharing a
    // fingerprint is a FingerprintJS false positive (same browser config),
    // not a security signal.
    const [fpMatch, ipMatch] = await Promise.all([
      fingerprint ? prisma.memberApplication.findFirst({ where: { fingerprint, status: 'rejected' }, select: { fullName: true, status: true } }) : Promise.resolve(null),
      ip          ? prisma.memberApplication.findFirst({ where: { ipAddress: ip, status: 'rejected' }, select: { fullName: true } }) : Promise.resolve(null),
    ])
    const isKnownDevice = !!(fpMatch || ipMatch || nameSimilar)

    // Aggregate suspicion score — single dimension admins can sort by. Each
    // signal contributes a weight; admins can later tune via constants. Score
    // 0-1 = normal, 2-3 = worth a glance, 4+ = high-suspicion (admin push
    // gets stronger language).
    let suspicionScore = 0
    if (timezoneMismatch) suspicionScore += 1   // possible VPN
    if (isDisposable)     suspicionScore += 2   // temp/throwaway email
    if (nameSimilar)      suspicionScore += 2   // close to a blacklist name
    if (fpMatch)          suspicionScore += 1   // fingerprint hit on prior decision
    if (ipMatch)          suspicionScore += 1   // IP hit on prior rejection
    if (!cleanPhone)      suspicionScore += 1   // no phone provided

    await prisma.memberApplication.create({
      data: {
        firstName, lastName, fullName,
        email:       cleanEmail,
        phone:       cleanPhone,
        birthdate:   birthdate  || null,
        gender:      gender     || null,
        country:     country    || null,
        city:        'Istanbul',
        neighborhood,
        instagram:   cleanInstagram,
        linkedin:    linkedin   || null,
        profession,  timeInCity, reasonHere,
        whyJoin,     enjoyWith,  goodCommunity,
        interests,   socialStyles, languages,
        contribution, groupBehavior, removedFromCommunity, toxicBehavior,
        aboutCommunity, socialJudgment,
        openToCoffee, openToLanguage, openToHosting,
        profilePhoto: profilePhoto || null,
        assignedClubs: [],
        bio,  source,
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
    if (isKnownDevice)     flags.push(fpMatch ? `known device (prev: ${fpMatch.fullName})` : ipMatch ? `known IP (prev: ${ipMatch.fullName})` : 'name similar to blacklist')
    if (timezoneMismatch)  flags.push(`timezone mismatch (browser: ${browserTz}, IP: ${ipTimezone})`)
    if (isDisposable)      flags.push('disposable email')
    if (nameSimilar && !isKnownDevice) flags.push('name similar to blacklisted person')

    const isSuspicious = flags.length > 0
    const notifTitle   = isSuspicious ? '⚠️ Suspicious application' : 'New application 📋'
    const notifBody    = isSuspicious
      ? `${fullName.trim()} — ${flags.join(' · ')}`
      : `${fullName.trim()} has applied to join Smileys.`

    await Promise.all(admins.map(a => createNotification(a.id, 'application', notifTitle, notifBody, '/admin/applications')))

    Promise.all([
      sendApplicationReceivedEmail(cleanEmail, fullName.trim()),
      sendAdminNewApplicationEmail(fullName.trim(), cleanEmail),
    ]).catch(e => console.error('Apply email error:', e))

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
