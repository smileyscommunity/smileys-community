import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { isSafeHref } from '@/lib/safeUrl'
import { writeAudit } from '@/lib/audit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json()

  // Whitelist allowed fields. Previously this PATCH passed the entire
  // request body directly to prisma.update, which let an admin (or a
  // compromised admin session) write arbitrary fields including `id`,
  // `createdAt`, the url field with `//evil.com`, etc. Mirror the
  // testimonials PATCH route which does this correctly.
  const data: Record<string, unknown> = {}
  if ('url' in body) {
    const cleanUrl = String(body.url ?? '').trim().slice(0, 2000)
    if (!cleanUrl || !isSafeHref(cleanUrl)) {
      return NextResponse.json({ error: 'URL must be a relative path or https:// URL' }, { status: 400 })
    }
    data.url = cleanUrl
  }
  if ('caption' in body) data.caption = body.caption ? String(body.caption).trim().slice(0, 300) : null
  if ('event'   in body) data.event   = body.event   ? String(body.event).trim().slice(0, 200)   : null
  if ('active'  in body) data.active  = !!body.active
  if ('order'   in body) data.order   = Math.max(0, Math.min(9999, Number(body.order) || 0))

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const item = await prisma.storyPhoto.update({ where: { id }, data })
  return NextResponse.json(item)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await params
  const snapshot = await prisma.storyPhoto.findUnique({ where: { id } })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await prisma.storyPhoto.delete({ where: { id } })
  writeAudit(session.id, session.name, 'story_photo.delete', id, 'story_photo',
    snapshot as Record<string, unknown>,
    `Deleted story photo (${snapshot.url ?? id})`,
  )
  return NextResponse.json({ ok: true })
}
