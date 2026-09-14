import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isSafeHref } from '@/lib/safeUrl'
import { normalizeInstagramHandle } from '@/lib/directory-constants'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'

// Partner access follows the account's CURRENT standing, read from the DB.
// getSession never refreshes role or partnerId from the row, and this route
// checked only the token's partnerId — which a demotion to member through the
// admin user page leaves set (and a re-login re-issues) — so a demoted partner
// kept editing their /perks listing. Only the partner capability goes: a member
// who owns a CLAIMED directory business still edits it via /api/directory/[id],
// which gates on Business.claimedById, not on role.
async function currentPartnerId(): Promise<string | null> {
  const session = await getSession()
  if (!session) return null
  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { role: true, partnerId: true } })
  return user?.role === 'partner' && user.partnerId ? user.partnerId : null
}

// The settings form shows this text as-is, so it says why rather than "Forbidden".
const NOT_A_PARTNER = 'This account is no longer linked to a partner business. Ask an admin if that looks wrong.'

export async function GET() {
  const partnerId = await currentPartnerId()
  if (!partnerId) {
    return NextResponse.json({ error: NOT_A_PARTNER }, { status: 403 })
  }

  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
  })

  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  return NextResponse.json(partner)
}

export async function PATCH(req: NextRequest) {
  const partnerId = await currentPartnerId()
  if (!partnerId) {
    return NextResponse.json({ error: NOT_A_PARTNER }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  // Every field here is rendered to every member (/perks): `website` as an
  // <a href>, the images as <img src>. This route copied the body verbatim —
  // a partner account could ship a javascript: link or a remote image, and a
  // non-string value 500'd. Same validators as the directory submit route.
  const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : v == null ? null : undefined
  const data: Record<string, string | null> = {}
  // Only a CHANGED value is validated and written (the admin partner PATCH does
  // the same). A stored legacy http:// website or "instagram.com/foo" handle,
  // echoed back by an older page, would otherwise 400 a save that only edits
  // the discount — and the partner has no way to see why.
  const current = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { name: true, category: true, discount: true, address: true, neighborhood: true, website: true, instagram: true, logo: true, coverImage: true },
  })
  // The account can lose its partner between the role check and here (admin
  // deleted the partner row) — a clean 404, not a P2025 500.
  if (!current) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  const norm = (v: unknown) => typeof v === 'string' ? (v.trim() || null) : v ?? null
  const unchanged = (key: keyof typeof current) => norm(body[key]) === norm(current[key])
  for (const [key, max] of [['name', 120], ['category', 60], ['discount', 200], ['address', 300], ['neighborhood', 80]] as const) {
    if (!(key in body) || unchanged(key)) continue
    const v = str(body[key], max)
    // All five are NOT NULL columns: a null (a cleared field serialised as
    // null) passed this check and 500'd in prisma.partner.update.
    if (typeof v !== 'string' || (key === 'name' && !v)) return NextResponse.json({ error: `${key} must be text` }, { status: 400 })
    data[key] = v
  }
  if ('website' in body && !unchanged('website')) {
    const v = str(body.website, 300)
    if (v === undefined || (v && !isSafeHref(v))) return NextResponse.json({ error: 'Website must start with https://' }, { status: 400 })
    data.website = v || null
  }
  if ('instagram' in body && !unchanged('instagram')) {
    const v = str(body.instagram, 60)
    if (v === undefined) return NextResponse.json({ error: 'Instagram must be text' }, { status: 400 })
    const handle = v ? normalizeInstagramHandle(v) : null
    if (v && !handle) return NextResponse.json({ error: 'Invalid Instagram handle' }, { status: 400 })
    if (handle !== current.instagram) data.instagram = handle
  }
  // An admin-set external logo is an unchanged value too. Only a CHANGED image
  // is held to the uploads-only rule (/perks renders these as <img> to every
  // member and CSP allows any https image, so a new external URL is a tracking pixel).
  for (const key of ['logo', 'coverImage'] as const) {
    if (!(key in body)) continue
    const v = str(body[key], 300)
    if (v === undefined) return NextResponse.json({ error: `${key} must be text` }, { status: 400 })
    if ((v || null) === (current?.[key] || null)) continue
    if (v && !isUploadedImageUrl(v)) return NextResponse.json({ error: `${key} must be an image uploaded through Smileys` }, { status: 400 })
    data[key] = v || null
  }

  const updated = await prisma.partner.update({
    where: { id: partnerId },
    data,
  })

  return NextResponse.json(updated)
}
