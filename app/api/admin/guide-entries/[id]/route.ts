import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManagePosts, canActInCity } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { validateGuideEntry, guideEntryPayload } from '@/lib/guideEntryInput'

type Params = { params: Promise<{ id: string }> }

// An entry's city is fixed at creation: moving one between cities would change
// which taxonomy and which neighborhood registry its values are validated
// against, and silently invalidate both. Delete and recreate instead.

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.guideEntry.findUnique({
    where:  { id },
    include: { city: { select: { id: true, slug: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canActInCity(session, existing.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const check = await validateGuideEntry(body, { cityId: existing.cityId, citySlug: existing.city.slug })
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  if (check.value.slug !== existing.slug) {
    const clash = await prisma.guideEntry.findUnique({
      where:  { cityId_kind_slug: { cityId: existing.cityId, kind: existing.kind, slug: check.value.slug } },
      select: { id: true },
    })
    if (clash) return NextResponse.json({ error: 'That slug already exists in this city' }, { status: 409 })
  }

  const updated = await prisma.guideEntry.update({
    where: { id },
    data:  guideEntryPayload(check.value),
    select: { id: true, slug: true, status: true },
  })
  await writeAudit(session.id, session.name, 'guide_entry_update', updated.id, 'guide_entry', {
    city: existing.city.slug,
    slug: updated.slug,
    // Publishing is the state change worth seeing in the log at a glance.
    statusFrom: existing.status, statusTo: updated.status,
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !canManagePosts(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.guideEntry.findUnique({
    where:  { id },
    include: { city: { select: { slug: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canActInCity(session, existing.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await prisma.guideEntry.delete({ where: { id } })
  await writeAudit(session.id, session.name, 'guide_entry_delete', id, 'guide_entry', {
    city: existing.city.slug, slug: existing.slug, title: existing.title,
  })
  return NextResponse.json({ ok: true })
}
