import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { isSafeHref } from '@/lib/safeUrl'
import {
  BUSINESS_CATEGORY_SET,
  DIRECTORY_LIMITS,
  normalizeInstagramHandle,
} from '@/lib/directory'

const PAGE_SIZE = 200

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'pending'

    const where: Record<string, unknown> = {}
    // Three filter buckets that partition every business:
    //   pending  → submitted, not yet reviewed
    //   approved → live in the directory
    //   rejected → reviewed and turned away (isApproved=false AND isActive=false)
    //
    // The original code had no `rejected` tab: rejecting a business set
    // both flags to false, and the page filtered by either {isApproved:false,
    // isActive:true} (pending) or {isApproved:true} (approved). Rejected
    // entries fell into neither bucket — admins couldn't see what they
    // had rejected without direct DB access.
    if (status === 'pending')  { where.isApproved = false; where.isActive = true  }
    if (status === 'approved') { where.isApproved = true }
    if (status === 'rejected') { where.isApproved = false; where.isActive = false }

    const businesses = await prisma.business.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      include: {
        submittedBy: { select: { id: true, name: true, email: true } },
        reviewedBy:  { select: { id: true, name: true } },
      },
    })

    return NextResponse.json(businesses)
  } catch (e) {
    console.error('Admin directory GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.slice(0, max)
}

// Schema-validate a PATCH field update. Returns either { data: validated
// patch } (only allowed keys, each through its normalizer) or { error:
// '...' } on the first invalid value. Mass-assigning user-supplied values
// to Prisma without per-field normalization (the original code's
// approach) lets through unbounded strings + unsafe URLs.
function validateFieldUpdate(input: Record<string, unknown>):
  | { data: Record<string, unknown> }
  | { error: string }
{
  const data: Record<string, unknown> = {}

  if ('name' in input) {
    const v = str(input.name, DIRECTORY_LIMITS.name)
    if (!v) return { error: 'Name cannot be empty' }
    data.name = v
  }
  if ('category' in input) {
    const v = str(input.category, 50)
    if (!v || !BUSINESS_CATEGORY_SET.has(v)) return { error: 'Invalid category' }
    data.category = v
  }
  if ('description' in input) {
    const v = str(input.description, DIRECTORY_LIMITS.description)
    if (!v) return { error: 'Description cannot be empty' }
    data.description = v
  }
  if ('neighborhood' in input) data.neighborhood = str(input.neighborhood, DIRECTORY_LIMITS.neighborhood)
  if ('address'      in input) data.address      = str(input.address,      DIRECTORY_LIMITS.address)
  if ('phone'        in input) data.phone        = str(input.phone,        DIRECTORY_LIMITS.phone)
  if ('languages'    in input) data.languages    = str(input.languages,    DIRECTORY_LIMITS.languages)

  if ('website' in input) {
    const v = str(input.website, DIRECTORY_LIMITS.website)
    if (v === null) {
      data.website = null
    } else if (!isSafeHref(v)) {
      return { error: 'Website must start with https://' }
    } else {
      data.website = v
    }
  }
  if ('instagram' in input) {
    if (typeof input.instagram !== 'string' || !input.instagram.trim()) {
      data.instagram = null
    } else {
      const handle = normalizeInstagramHandle(input.instagram)
      if (!handle) return { error: 'Invalid Instagram handle' }
      data.instagram = handle
    }
  }
  // logo + coverImage are admin-set URLs (the public submission flow
  // doesn't accept them). Still validate — the original mass-assign let
  // an admin paste a javascript: URL that would XSS every directory
  // viewer through resolveImageUrl.
  for (const k of ['logo', 'coverImage'] as const) {
    if (k in input) {
      const v = str(input[k], DIRECTORY_LIMITS[k])
      if (v === null) {
        data[k] = null
      } else if (!isSafeHref(v)) {
        return { error: `${k} must be an https:// URL` }
      } else {
        data[k] = v
      }
    }
  }
  if ('isExpatOwned'    in input) data.isExpatOwned    = !!input.isExpatOwned
  if ('isExpatFriendly' in input) data.isExpatFriendly = !!input.isExpatFriendly

  return { data }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { id, action, ...fields } = body as Record<string, unknown>
    if (typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 })
    }

    const existing = await prisma.business.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (action === 'approve') {
      await prisma.business.update({
        where: { id },
        data: { isApproved: true, isActive: true, reviewedById: session.id, reviewedAt: new Date() },
      })
      await createNotification(existing.submittedById, 'system',
        'Business listing approved!',
        `"${existing.name}" is now live in the Smileys directory.`,
        '/directory',
      )
      await writeAudit(session.id, session.name, 'directory.approve', id, 'business', { name: existing.name })
      return NextResponse.json({ ok: true })
    }

    if (action === 'reject') {
      await prisma.business.update({
        where: { id },
        data: { isApproved: false, isActive: false, reviewedById: session.id, reviewedAt: new Date() },
      })
      await createNotification(existing.submittedById, 'system',
        'Business listing not approved',
        `"${existing.name}" was not approved for the directory. Contact an admin for more info.`,
        '/directory',
      )
      await writeAudit(session.id, session.name, 'directory.reject', id, 'business', { name: existing.name })
      return NextResponse.json({ ok: true })
    }

    if (action === 'toggle-active') {
      const next = !existing.isActive
      await prisma.business.update({ where: { id }, data: { isActive: next } })
      await writeAudit(session.id, session.name, 'directory.toggle_active', id, 'business', { name: existing.name, active: next })
      return NextResponse.json({ ok: true })
    }

    // Generic field update — schema-validated.
    const result = validateFieldUpdate(fields)
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    if (Object.keys(result.data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await prisma.business.update({ where: { id }, data: result.data })
    await writeAudit(session.id, session.name, 'directory.update', id, 'business', {
      name: existing.name, fields: Object.keys(result.data),
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('Admin directory PATCH error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const id = body && typeof body === 'object' ? (body as Record<string, unknown>).id : null
    if (typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 })
    }

    const existing = await prisma.business.findUnique({ where: { id }, select: { name: true } })
    if (!existing) return NextResponse.json({ ok: true })

    await prisma.business.delete({ where: { id } })
    await writeAudit(session.id, session.name, 'directory.delete', id, 'business', { name: existing.name })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Admin directory DELETE error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
