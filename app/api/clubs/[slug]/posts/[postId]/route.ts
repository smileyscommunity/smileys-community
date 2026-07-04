import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ slug: string; postId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

  const { slug, postId } = await params
  const { isPinned, content } = await req.json()

  // IDOR fix: scope the post lookup by the slug's clubId so a host of club
  // A cannot pin a post in club B by passing `/api/clubs/A/posts/<B-post-id>`.
  // We fetch club + post + (conditionally) membership in parallel.
  const [club, post] = await Promise.all([
    prisma.club.findUnique({ where: { slug }, select: { id: true } }),
    prisma.clubPost.findUnique({ where: { id: postId }, select: { id: true, clubId: true, userId: true } }),
  ])
  if (!club || !post || post.clubId !== club.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // ── Edit content ──────────────────────────────────────────────────────────
  // Authors can edit their own posts/announcements; club hosts, admins, and
  // moderators can edit any (same authority that lets them delete).
  if (typeof content === 'string') {
    if (!await rateLimit(`post-edit:${session.id}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Too many edits' }, { status: 429 })
    }
    const trimmed = content.trim()
    if (!trimmed)              return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    if (trimmed.length > 2000) return NextResponse.json({ error: 'Post too long (max 2000 chars)' }, { status: 400 })

    // Admins/mods can edit anything. Otherwise the editor must still be an
    // approved member of THIS club: an owner who was removed/suspended must
    // not be able to keep rewriting their old posts, and a host can edit any.
    if (!isAdminOrModerator(session)) {
      const membership = await prisma.clubMembership.findUnique({
        where: { userId_clubId: { userId: session.id, clubId: club.id } },
        select: { role: true, status: true },
      })
      const isApprovedMember = membership?.status === 'approved'
      const isHost           = isApprovedMember && membership?.role === 'host'
      const isOwner          = post.userId === session.id
      if (!isHost && !(isOwner && isApprovedMember)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const updated = await prisma.clubPost.update({
      where: { id: postId },
      data: { content: trimmed, editedAt: new Date() },
      select: { id: true, content: true, editedAt: true },
    })
    return NextResponse.json(updated)
  }

  // ── Pin / unpin (club hosts, admins, or moderators only) ──────────────────
  const isPrivilegedPin = isAdminOrModerator(session)
  if (!isPrivilegedPin) {
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: club.id } },
      select: { role: true, status: true },
    })
    if (membership?.role !== 'host' || membership.status !== 'approved') {
      return NextResponse.json({ error: 'Only hosts can pin posts' }, { status: 403 })
    }
  }

  const updated = await prisma.clubPost.update({
    where: { id: postId },
    data: { isPinned: !!isPinned, pinnedAt: isPinned ? new Date() : null },
    select: { id: true, isPinned: true },
  })
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  if (!await rateLimit(`post-delete:${session.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many deletions' }, { status: 429 })
  }

  const { slug, postId } = await params
  // IDOR fix: scope the post lookup by the slug's clubId — see PATCH above.
  const [club, post] = await Promise.all([
    prisma.club.findUnique({ where: { slug }, select: { id: true } }),
    prisma.clubPost.findUnique({ where: { id: postId }, select: { userId: true, clubId: true } }),
  ])
  if (!club || !post || post.clubId !== club.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const isOwner      = post.userId === session.id
  const isPrivileged = isAdminOrModerator(session)

  if (!isOwner && !isPrivileged) {
    // Club host for this specific club can also delete
    const membership = await prisma.clubMembership.findUnique({
      where: { userId_clubId: { userId: session.id, clubId: post.clubId } },
      select: { role: true, status: true },
    })
    if (membership?.role !== 'host' || membership.status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  await prisma.clubPost.delete({ where: { id: postId } })
  return NextResponse.json({ ok: true })
}
