import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'

// Mirror of the prizes admin route but for CupSponsor. Same auth,
// same shape: GET + POST + PATCH + DELETE. Slugs are required on
// create (admin chooses) and uniqueness-enforced via P2002.

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sponsors = await prisma.cupSponsor.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: {
      id: true, slug: true, name: true, blurb: true,
      logoUrl: true, websiteUrl: true, instagramUrl: true,
      status: true, createdAt: true, updatedAt: true,
      addedBy: { select: { id: true, name: true } },
      _count: { select: { prizes: true } },
    },
  })
  return NextResponse.json({ sponsors })
}

const SLUG_RE = /^[a-z0-9-]+$/

function parsePayload(body: Record<string, unknown>) {
  const name        = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : null
  const slug        = typeof body.slug === 'string' ? body.slug.trim().toLowerCase().slice(0, 80) : null
  const blurb       = typeof body.blurb === 'string' ? body.blurb.trim().slice(0, 500) : null
  const logoUrl     = typeof body.logoUrl === 'string' ? body.logoUrl.trim().slice(0, 500) : null
  const websiteUrl  = typeof body.websiteUrl === 'string' ? body.websiteUrl.trim().slice(0, 500) : null
  const instagramUrl = typeof body.instagramUrl === 'string' ? body.instagramUrl.trim().slice(0, 500) : null
  const status      = typeof body.status === 'string' && ['pending', 'active', 'archived'].includes(body.status) ? body.status : null
  return { name, slug, blurb, logoUrl, websiteUrl, instagramUrl, status }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const p = parsePayload(body)
  if (!p.name)                                   return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!p.slug || !SLUG_RE.test(p.slug))          return NextResponse.json({ error: 'slug must be lowercase letters, digits, hyphens' }, { status: 400 })

  try {
    const sponsor = await prisma.cupSponsor.create({
      data: {
        name: p.name, slug: p.slug, blurb: p.blurb,
        logoUrl: p.logoUrl, websiteUrl: p.websiteUrl, instagramUrl: p.instagramUrl,
        status: p.status ?? 'active',
        addedByUserId: session.id,
      },
    })
    writeAudit(session.id, session.name, 'cup.sponsor_create', sponsor.id, 'cup_sponsor',
      { name: sponsor.name, slug: sponsor.slug, status: sponsor.status },
      `Added sponsor "${sponsor.name}"`,
    )
    return NextResponse.json({ sponsor })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'Slug already in use — pick another' }, { status: 409 })
    throw e
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const before = await prisma.cupSponsor.findUnique({ where: { id } })
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const p = parsePayload(body)
  if (p.slug && !SLUG_RE.test(p.slug)) return NextResponse.json({ error: 'slug must be lowercase letters, digits, hyphens' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (p.name)                                                   data.name         = p.name
  if (p.slug)                                                   data.slug         = p.slug
  if (p.blurb !== null && p.blurb !== undefined)                data.blurb        = p.blurb
  if (p.logoUrl !== null && p.logoUrl !== undefined)            data.logoUrl      = p.logoUrl
  if (p.websiteUrl !== null && p.websiteUrl !== undefined)      data.websiteUrl   = p.websiteUrl
  if (p.instagramUrl !== null && p.instagramUrl !== undefined)  data.instagramUrl = p.instagramUrl
  if (p.status)                                                 data.status       = p.status

  try {
    const sponsor = await prisma.cupSponsor.update({ where: { id }, data })
    writeAudit(session.id, session.name, 'cup.sponsor_update', id, 'cup_sponsor',
      { name: sponsor.name, changed: Object.keys(data) },
      `Updated sponsor "${sponsor.name}"`,
    )
    return NextResponse.json({ sponsor })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'Slug already in use' }, { status: 409 })
    throw e
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const sponsor = await prisma.cupSponsor.findUnique({ where: { id }, select: { name: true } })
  if (!sponsor) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.cupSponsor.delete({ where: { id } })
  writeAudit(session.id, session.name, 'cup.sponsor_delete', id, 'cup_sponsor',
    { name: sponsor.name },
    `Deleted sponsor "${sponsor.name}"`,
  )
  return NextResponse.json({ ok: true })
}
