import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { isAdminOrModerator } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { sendAdminNewDirectorySubmissionEmail } from '@/lib/email'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { isSafeHref } from '@/lib/safeUrl'
import {
  BUSINESS_CATEGORY_SET,
  DIRECTORY_LIMITS,
  normalizeInstagramHandle,
  queryDirectory,
  type DirectorySort,
} from '@/lib/directory'
import { isValidNeighborhoodFor } from '@/lib/neighborhoodsDb'

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'anon'
    if (!await rateLimit(`directory:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    // Public read — no session required. POST remains gated.
    const session = await getSession()
    const { searchParams } = new URL(req.url)
    const category     = searchParams.get('category') || ''
    const neighborhood = searchParams.get('neighborhood') || ''
    const type         = searchParams.get('type') || ''
    const sortParam    = searchParams.get('sort')
    const sort         = (sortParam === 'trending' || sortParam === 'toprated' ? sortParam : 'recent') as DirectorySort
    const cursor       = searchParams.get('cursor') || undefined

    if (category && category !== 'all' && !BUSINESS_CATEGORY_SET.has(category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }
    if (neighborhood && !await isValidNeighborhoodFor(await resolveCityId(session), neighborhood)) {
      return NextResponse.json({ error: 'Invalid neighborhood' }, { status: 400 })
    }

    const { items, nextCursor, total } = await queryDirectory({
      cityId:       await resolveCityId(session),
      category:     category || undefined,
      neighborhood: neighborhood || undefined,
      type:         type || undefined,
      sort,
      cursor,
      callerId:     session?.id,
    })

    return NextResponse.json(items, {
      headers: {
        'X-Total-Count': String(total),
        ...(nextCursor ? { 'X-Next-Cursor': nextCursor } : {}),
      },
    })
  } catch (e) {
    console.error('Directory GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Replace the previous DB-count rate limit. That did a per-request
    // SELECT COUNT(*) on every POST, and counted rejected (isActive=false)
    // rows as if they were live submissions. The proper rateLimit() helper
    // uses Redis-style counters and is cheaper.
    if (!await rateLimit(`directory-submit:${session.id}`, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many submissions this hour' }, { status: 429 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const name        = str(body.name,        DIRECTORY_LIMITS.name)
    const category    = str(body.category,    50)
    const description = str(body.description, DIRECTORY_LIMITS.description)
    if (!name || !category || !description) {
      return NextResponse.json({ error: 'Name, category, and description are required' }, { status: 400 })
    }
    if (!BUSINESS_CATEGORY_SET.has(category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }

    // Optional fields. Each goes through length-capped str(); URLs are
    // validated against the isSafeHref allowlist (https / mailto only)
    // so a malicious submission can't ship a javascript:/data: URL out
    // to every member who clicks "Website".
    const neighborhood = str(body.neighborhood, DIRECTORY_LIMITS.neighborhood)
    const address      = str(body.address,      DIRECTORY_LIMITS.address)
    const phone        = str(body.phone,        DIRECTORY_LIMITS.phone)
    const languages    = str(body.languages,    DIRECTORY_LIMITS.languages)

    const websiteRaw   = str(body.website, DIRECTORY_LIMITS.website)
    let website: string | null = null
    if (websiteRaw) {
      if (!isSafeHref(websiteRaw)) {
        return NextResponse.json({ error: 'Website must start with https://' }, { status: 400 })
      }
      website = websiteRaw
    }

    // Instagram comes in as a handle, but users paste full URLs and
    // admins may include the leading @. Normalize to bare handle and
    // reject anything that isn't a valid handle (letters/digits/_/.).
    let instagram: string | null = null
    if (typeof body.instagram === 'string' && body.instagram.trim()) {
      instagram = normalizeInstagramHandle(body.instagram)
      if (!instagram) {
        return NextResponse.json({ error: 'Invalid Instagram handle' }, { status: 400 })
      }
    }

    // Cover image — accept only paths that point at the /api/files/
    // directory subfolder. Anything else (external URL, listings/users
    // subfolder, JS-injected string) gets dropped to null so a malicious
    // submission can't ship a tracking pixel or unrelated asset.
    let coverImage: string | null = null
    if (typeof body.coverImage === 'string' && body.coverImage.trim()) {
      const raw = body.coverImage.trim()
      if (/^\/app\/api\/files\/directory\/[\w-]+\.(jpg|jpeg|png|webp|gif)$/i.test(raw)) {
        coverImage = raw
      }
    }

    // Auto-approve only for admin role. Moderators submitting their own
    // listings still go through review — they're trusted enough to triage
    // but not to publish directly without a second pair of eyes.
    const autoApprove = session.role === 'admin'

    const business = await prisma.business.create({
      data: {
        name,
        cityId: await resolveCityId(session),
        category,
        description,
        neighborhood,
        address,
        phone,
        website,
        instagram,
        languages,
        coverImage,
        isExpatOwned:    !!body.isExpatOwned,
        isExpatFriendly: !!body.isExpatFriendly,
        submittedById: session.id,
        isApproved: autoApprove,
      },
    })

    if (!autoApprove) {
      const admins = await prisma.user.findMany({
        where: { role: { in: ['admin', 'moderator'] } },
        select: { id: true },
      })
      // In-app + push, fanned out to every admin/moderator. Switched
      // from the generic 'system' type to 'directory_submission' so
      // these get a distinct 📋 icon in the bell (previously buried
      // among any other system entries with the fallback 🔔).
      await Promise.all(admins.map(a =>
        createNotification(
          a.id,
          'directory_submission',
          'New business submission',
          `${session.name} submitted "${business.name}" for directory approval`,
          '/admin/directory',
        ),
      ))
      // Single-recipient email to the ADMIN_EMAIL inbox — same shape as
      // sendAdminNewApplicationEmail. Non-blocking + catches its own
      // failures so a Resend hiccup doesn't roll back the submission.
      sendAdminNewDirectorySubmissionEmail(session.name, business.name).catch(e => {
        console.error('Directory submission email failed:', e)
      })
    }

    return NextResponse.json({ ok: true, id: business.id, approved: business.isApproved })
  } catch (e) {
    console.error('Directory POST error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
