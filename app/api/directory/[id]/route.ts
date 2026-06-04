import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { validateFieldUpdate, dropUnchanged } from '@/app/api/admin/directory/_lib'

// PATCH /api/directory/[id] — verified-owner self-edit. Reuses the
// same field-update validator as /api/admin/directory PATCH so the
// allowlist (and URL / category / hours / discount rules) stays
// identical between the two paths.
//
// Access:
//   - Admin/moderator: allowed for any business (mirrors the admin
//     route for owners who happen to also be staff).
//   - Verified owner: allowed only when session.id === b.claimedById.
//     Anyone else gets 404 (don't leak existence of business).
//
// Fields restricted to admin-only stay out of the validator entirely
// — owners can never approve/reject, change moderation flags, or
// reassign ownership.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // Fetch every column that the validator might touch so dropUnchanged
    // has the full prior state to compare against.
    const existing = await prisma.business.findUnique({
      where: { id },
      select: {
        id: true, claimedById: true, name: true, category: true, description: true,
        neighborhood: true, address: true, phone: true,
        website: true, instagram: true, logo: true, coverImage: true,
        languages: true, latitude: true, longitude: true,
        hours: true, memberDiscount: true, tags: true,
        isExpatOwned: true, isExpatFriendly: true,
        isApproved: true, isActive: true,
      },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const isOwner = existing.claimedById === session.id
    const isStaff = isAdminOrModerator(session)
    if (!isOwner && !isStaff) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    // Owners can only edit live (approved+active) listings — editing a
    // rejected/inactive entry would let them silently undo a moderation
    // decision. Staff aren't subject to this.
    if (!isStaff && (!existing.isApproved || !existing.isActive)) {
      return NextResponse.json({ error: 'This listing is currently inactive — contact an admin.' }, { status: 403 })
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const result = validateFieldUpdate(body)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    if (Object.keys(result.data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    const data = dropUnchanged(result.data, existing as unknown as Record<string, unknown>)
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: true, unchanged: true })
    }

    await prisma.business.update({ where: { id }, data })
    await writeAudit(
      session.id, session.name,
      isOwner ? 'directory.owner_update' : 'directory.update',
      id, 'business',
      { name: existing.name, fields: Object.keys(data) },
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Directory owner PATCH error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
