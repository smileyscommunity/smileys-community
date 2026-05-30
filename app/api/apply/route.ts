import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendApplicationReceivedEmail, sendAdminNewApplicationEmail } from '@/lib/email'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { verifyTurnstile } from '@/lib/turnstile'
import { sendPushToUser } from '@/lib/push'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const disposableDomains: string[] = require('disposable-email-domains')

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

    const { firstName, lastName, email, phone, birthdate, gender, country, city, neighborhood, instagram, linkedin,
            profession, timeInCity, reasonHere,
            // New consolidated fields (UI now posts these instead of the 3+3 below)
            aboutCommunity, socialJudgment, languages,
            openToCoffee, openToLanguage, openToHosting,
            // Legacy fields still accepted so older clients / drafts don't break;
            // routed to their existing columns and not surfaced in the new UI.
            whyJoin, enjoyWith, goodCommunity, interests, socialStyles,
            contribution, groupBehavior, removedFromCommunity, toxicBehavior,
            profilePhoto,
            // targetCitySlug — which community they're applying to. Defaults to
            // istanbul for backwards compat with older clients that don't post it.
            targetCitySlug,
            bio, source, referredBy, _hp, _cf, _fp, _tz } = await req.json()

    if (!(await verifyTurnstile(_cf ?? '', getIp(req)))) {
      return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
    }

    if (_hp) return NextResponse.json({ ok: true })

    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !phone?.trim() || !country?.trim() || !neighborhood?.trim() || !gender?.trim()) {
      return NextResponse.json({ error: 'Name, email, phone, country, neighborhood, and gender are required' }, { status: 400 })
    }

    // Resolve the target city from the slug the form posted (or
    // Istanbul if the client didn't send one — older builds). Reject
    // applications to paused cities at the door.
    const wantedSlug = (typeof targetCitySlug === 'string' && targetCitySlug.trim()) || 'istanbul'
    const targetCity = await prisma.city.findUnique({
      where: { slug: wantedSlug },
      select: { id: true, status: true },
    })
    if (!targetCity || targetCity.status === 'paused') {
      return NextResponse.json({ error: `Applications to "${wantedSlug}" aren't open right now.` }, { status: 400 })
    }
    const targetCityId = targetCity.id

    const fullName = `${firstName.trim()} ${lastName.trim()}`
    if (!profilePhoto?.trim()) {
      return NextResponse.json({ error: 'Profile photo is required' }, { status: 400 })
    }
    if (!/^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(profilePhoto.trim())) {
      return NextResponse.json({ error: 'Invalid profile photo' }, { status: 400 })
    }

    const cleanEmail     = email.toLowerCase().trim()
    const cleanPhone     = phone?.trim()     || null
    const cleanInstagram = instagram?.trim() || null
    const cleanRef       = referredBy?.trim() || null
    const validRef       = cleanRef && /^[A-Z2-9]{8}$/.test(cleanRef) ? cleanRef : null

    // Blacklist check — email, phone, fingerprint, IP
    const ip = (req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '').split(',')[0].trim() || null
    const fingerprint = typeof _fp === 'string' ? _fp.slice(0, 64) : null
    const blacklisted = await prisma.blacklist.findFirst({
      where: {
        OR: [
          cleanEmail    ? { email: cleanEmail }       : {},
          cleanPhone    ? { phone: cleanPhone }        : {},
          fingerprint   ? { fingerprint }              : {},
          ip            ? { ipAddress: ip }            : {},
        ],
      },
    })
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
    const recentRejection = await prisma.memberApplication.findFirst({
      where: {
        status: 'rejected',
        reviewedAt: { gte: cooldownDate },
        OR: [
          cleanPhone  ? { phone: cleanPhone }        : {},
          fingerprint ? { fingerprint }               : {},
          ip          ? { ipAddress: ip }             : {},
        ],
      },
    })
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

    // Fingerprint / IP velocity — auto-reject if more than 2 in 24h from same device/IP
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [fpCount, ipCount] = await Promise.all([
      fingerprint ? prisma.memberApplication.count({ where: { fingerprint, createdAt: { gte: since24h } } }) : Promise.resolve(0),
      ip          ? prisma.memberApplication.count({ where: { ipAddress: ip, createdAt: { gte: since24h } } }) : Promise.resolve(0),
    ])
    const velocityBlock = fpCount >= 2 || ipCount >= 2

    // Similar name check against blacklist
    const blacklistNames = await prisma.blacklist.findMany({ select: { name: true } })
    const nameSimilar = blacklistNames.some(b => b.name && nameDistance(fullName, b.name) < 0.35)

    // Notify admins if known device/IP or suspicious signals
    const admins = await prisma.user.findMany({ where: { role: { in: ['admin', 'moderator'] } }, select: { id: true } })

    if (velocityBlock) {
      // Still save but mark as rejected immediately
      await prisma.memberApplication.create({
        data: {
          firstName: firstName.trim(), lastName: lastName.trim(), fullName: fullName.trim(),
          email: cleanEmail, phone: cleanPhone, ipAddress: ip, userAgent: req.headers.get('user-agent')?.slice(0, 500) || null,
          fingerprint, timezone: browserTz, timezoneMismatch, disposableEmail: isDisposable,
          status: 'rejected', reviewNote: 'Auto-rejected: velocity limit (same device/IP within 24h)',
          assignedClubs: [], interests: [], socialStyles: [],
          targetCityId,
        },
      })
      for (const admin of admins) {
        sendPushToUser(admin.id, {
          title: '⚠️ Velocity block triggered',
          body: `${fullName} was auto-rejected — same device/IP applied 3+ times in 24h`,
          link: '/admin/applications',
        }).catch(() => {})
      }
      return NextResponse.json({ error: 'This application cannot be accepted.' }, { status: 403 })
    }

    // Check if fingerprint or IP matches an existing application — alert admins
    const [fpMatch, ipMatch] = await Promise.all([
      fingerprint ? prisma.memberApplication.findFirst({ where: { fingerprint, status: { not: 'pending' } }, select: { fullName: true, status: true } }) : Promise.resolve(null),
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
        firstName:   firstName.trim(),
        lastName:    lastName.trim(),
        fullName:    fullName.trim(),
        email:       cleanEmail,
        phone:       cleanPhone,
        birthdate:   birthdate?.trim() || null,
        gender:      gender?.trim()    || null,
        country:      country?.trim()       || null,
        city:         'Istanbul',
        neighborhood: neighborhood.trim(),
        instagram:   cleanInstagram,
        linkedin:    linkedin?.trim()    || null,
        profession:           profession?.trim()           || null,
        timeInCity:           timeInCity?.trim()           || null,
        reasonHere:           reasonHere?.trim()           || null,
        whyJoin:              whyJoin?.trim()              || null,
        enjoyWith:            enjoyWith?.trim()            || null,
        goodCommunity:        goodCommunity?.trim()        || null,
        interests:            Array.isArray(interests)    ? interests    : [],
        socialStyles:         Array.isArray(socialStyles) ? socialStyles : [],
        languages:            Array.isArray(languages)    ? languages    : [],
        contribution:         contribution?.trim()         || null,
        groupBehavior:        groupBehavior?.trim()        || null,
        removedFromCommunity: removedFromCommunity?.trim() || null,
        toxicBehavior:        toxicBehavior?.trim()        || null,
        // Consolidated essay + judgment fields — current UI posts these instead.
        aboutCommunity:       aboutCommunity?.trim()       || null,
        socialJudgment:       socialJudgment?.trim()       || null,
        openToCoffee:         openToCoffee   === true,
        openToLanguage:       openToLanguage === true,
        openToHosting:        openToHosting  === true,
        profilePhoto:         profilePhoto?.trim()         || null,
        assignedClubs:        [],
        bio:                  bio?.trim()                  || null,
        source:               source?.trim()               || null,
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

    if (isSuspicious) {
      admins.forEach(a => sendPushToUser(a.id, { title: notifTitle, body: notifBody, link: '/admin/applications' }).catch(() => {}))
    }

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
