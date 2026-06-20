import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { verifyTurnstile } from '@/lib/turnstile'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const disposableDomains: string[] = require('disposable-email-domains')

const FOUNDER_CAP = 100

// Smileys Pro waitlist signup. Mirrors the /api/advertise anti-spam
// stack (rate-limit, honeypot, timing, Turnstile) but treats this as
// an aspirational opt-in, not a B2B inquiry — the response includes
// position + founderCap so the client can render "you're #43 of 100
// founding members" celebratory UI.
//
// Email is the natural-key dedupe: re-submitting the same email just
// returns the existing entry's position instead of creating a duplicate
// row. That way the page works correctly when someone signs up, closes
// the tab, comes back later, and submits again — they see their
// existing rank.
export async function POST(req: NextRequest) {
  if (!await rateLimit(`pro-waitlist:${getIp(req)}`, 3, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  try {
    const session = await getSession()
    const body = await req.json()
    const { name, email, industry, role, _hp, _t, _cf } = body

    if (_hp) return NextResponse.json({ ok: true })
    if (!_t || Date.now() - Number(_t) < 3000) return NextResponse.json({ ok: true })

    // Logged-in members skip Turnstile — they're vetted via application
    // and the captcha is friction for the audience we most want to convert.
    if (!session) {
      if (!(await verifyTurnstile(_cf ?? '', getIp(req)))) {
        return NextResponse.json({ error: 'Human verification failed. Please try again.' }, { status: 400 })
      }
    }

    const cleanName  = (name  ?? session?.name  ?? '').trim()
    const cleanEmail = (email ?? session?.email ?? '').trim().toLowerCase()
    if (!cleanName || !cleanEmail) return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || /[\r\n]/.test(cleanEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }
    if (/[\r\n]/.test(cleanName)) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    const domain = cleanEmail.split('@')[1]
    if (domain && disposableDomains.includes(domain)) {
      return NextResponse.json({ error: 'Please use a permanent email address' }, { status: 400 })
    }

    const cleanIndustry = industry ? String(industry).trim().slice(0, 80) : null
    const cleanRole     = role     ? String(role).trim().slice(0, 80)     : null

    // Upsert on email so re-submissions are idempotent. First answer
    // wins for industry/role — a re-submit is typically a "did it work"
    // check, not a deliberate edit.
    const entry = await prisma.proWaitlistEntry.upsert({
      where:  { email: cleanEmail },
      update: { name: cleanName },
      create: {
        userId:   session?.id ?? null,
        name:     cleanName,
        email:    cleanEmail,
        industry: cleanIndustry,
        role:     cleanRole,
      },
    })

    const position = await prisma.proWaitlistEntry.count({
      where: { createdAt: { lte: entry.createdAt } },
    })

    return NextResponse.json({
      ok: true,
      position,
      founderCap: FOUNDER_CAP,
      isFounder:  position <= FOUNDER_CAP,
    })
  } catch (e) {
    console.error('pro-waitlist: submission failed', e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

// Public counter for the hero — live signup count creates social proof.
// Cached briefly to absorb thundering-herd at announcement time.
export async function GET() {
  const total = await prisma.proWaitlistEntry.count()
  return NextResponse.json(
    { total, founderCap: FOUNDER_CAP, foundersRemaining: Math.max(0, FOUNDER_CAP - total) },
    { headers: { 'Cache-Control': 'public, max-age=30' } },
  )
}
