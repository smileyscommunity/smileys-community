import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isSafeHref } from '@/lib/safeUrl'
import { normalizeInstagramHandle } from '@/lib/directory-constants'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'

export async function GET() {
  const session = await getSession()
  if (!session || !session.partnerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const partner = await prisma.partner.findUnique({
    where: { id: session.partnerId },
  })

  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  return NextResponse.json(partner)
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !session.partnerId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  // Every field here is rendered to every member (/perks): `website` as an
  // <a href>, the images as <img src>. This route copied the body verbatim —
  // a partner account could ship a javascript: link or a remote image, and a
  // non-string value 500'd. Same validators as the directory submit route.
  const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : v == null ? null : undefined
  const data: Record<string, string | null> = {}
  for (const [key, max] of [['name', 120], ['category', 60], ['discount', 200], ['address', 300], ['neighborhood', 80]] as const) {
    if (!(key in body)) continue
    const v = str(body[key], max)
    if (v === undefined || (key === 'name' && !v)) return NextResponse.json({ error: `${key} must be text` }, { status: 400 })
    data[key] = v
  }
  if ('website' in body) {
    const v = str(body.website, 300)
    if (v === undefined || (v && !isSafeHref(v))) return NextResponse.json({ error: 'Website must start with https://' }, { status: 400 })
    data.website = v || null
  }
  if ('instagram' in body) {
    const v = str(body.instagram, 60)
    if (v === undefined) return NextResponse.json({ error: 'Instagram must be text' }, { status: 400 })
    const handle = v ? normalizeInstagramHandle(v) : null
    if (v && !handle) return NextResponse.json({ error: 'Invalid Instagram handle' }, { status: 400 })
    data.instagram = handle
  }
  for (const key of ['logo', 'coverImage'] as const) {
    if (!(key in body)) continue
    const v = str(body[key], 300)
    // Uploads only: /perks renders these as <img> to every member and CSP
    // allows any https image, so an external URL is a per-member tracking
    // pixel. An admin-set external logo is left alone when not resent.
    if (v === undefined || (v && !isUploadedImageUrl(v))) return NextResponse.json({ error: `${key} must be an image uploaded through Smileys` }, { status: 400 })
    data[key] = v || null
  }

  const updated = await prisma.partner.update({
    where: { id: session.partnerId },
    data,
  })

  return NextResponse.json(updated)
}
