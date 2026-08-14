import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId } from '@/lib/city'
import { isAdminOrModerator } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { writeAudit } from '@/lib/audit'
import { validateBusinessCreate, validateFieldUpdate, dropUnchanged } from './_lib'

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


// POST /api/admin/directory — admin-create. Accepts either a single
// business via { business: {...} } or a bulk batch via { businesses:
// [{...}, ...] }. Auto-approves (admins bypass review). Bulk path runs
// every row through the same validator; row-level errors surface in the
// response without rolling back the rest of the batch (best-effort
// upload). Per-call cap of 200 rows keeps a single request from
// monopolizing the DB.
const BULK_MAX = 200

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // Detect single vs bulk shape. We accept both `businesses` (array)
    // and `business` (object) at the top level so the client can stay
    // explicit about intent.
    const single = (body as Record<string, unknown>).business
    const bulk   = (body as Record<string, unknown>).businesses

    if (Array.isArray(bulk)) {
      if (bulk.length === 0) {
        return NextResponse.json({ error: 'No businesses to import' }, { status: 400 })
      }
      if (bulk.length > BULK_MAX) {
        return NextResponse.json({ error: `Bulk import limited to ${BULK_MAX} rows at a time` }, { status: 400 })
      }

      // Two-pass: validate every row up front (no DB), then a single
      // createMany batch insert for the survivors. Previous code
      // round-tripped to the DB once per row — a 200-row import was
      // 200 sequential creates, and a connection drop mid-loop left a
      // partial import behind with no atomicity guarantee. createMany
      // collapses to one statement, atomic at the DB level.
      const validated: { index: number; data: Record<string, unknown>; name: string }[] = []
      const errors:    { index: number; name?: string; error: string }[] = []

      for (let i = 0; i < bulk.length; i++) {
        const row = bulk[i]
        if (!row || typeof row !== 'object') {
          errors.push({ index: i, error: 'Row is not an object' })
          continue
        }
        const result = validateBusinessCreate(row as Record<string, unknown>)
        if ('error' in result) {
          errors.push({
            index: i,
            name: typeof (row as { name?: unknown }).name === 'string'
              ? (row as { name: string }).name
              : undefined,
            error: result.error,
          })
          continue
        }
        validated.push({
          index: i,
          data: {
            ...(result.data as Record<string, unknown>),
            // The `as never` casts below bypass tsc, so a missing cityId
            // here would surface as a runtime NOT NULL violation — keep it.
            cityId:        await resolveCityId(session),
            submittedById: session.id,
            reviewedById:  session.id,
            reviewedAt:    new Date(),
            isApproved:    true,
            isActive:      true,
          },
          name: (result.data as { name: string }).name,
        })
      }

      let createdCount = 0
      if (validated.length > 0) {
        try {
          const res = await prisma.business.createMany({
            data: validated.map(v => v.data) as never,
          })
          createdCount = res.count
        } catch (e) {
          // createMany aborts the whole batch on any constraint
          // violation — fall back to per-row inserts so the offending
          // row(s) can be reported individually instead of failing the
          // whole import. Restores the original best-effort semantics.
          console.error('Bulk createMany failed, falling back per-row:', e)
          for (const v of validated) {
            try {
              await prisma.business.create({ data: v.data as never })
              createdCount++
            } catch (rowErr) {
              console.error('Bulk fallback row failed:', rowErr)
              errors.push({ index: v.index, name: v.name, error: 'DB error' })
            }
          }
        }
      }

      if (createdCount > 0) {
        await writeAudit(
          session.id, session.name,
          'directory.bulk_create',
          undefined, 'business',
          {
            created: createdCount,
            failed: errors.length,
            // Names come from the validated input rather than DB row
            // ids (createMany doesn't return rows in Postgres without
            // createManyAndReturn) — same first-20 sample as before.
            names: validated.slice(0, 20).map(v => v.name),
          },
        )
      }

      return NextResponse.json({ ok: true, created: createdCount, failed: errors.length, errors })
    }

    if (!single || typeof single !== 'object') {
      return NextResponse.json({ error: 'Expected { business } or { businesses }' }, { status: 400 })
    }
    const result = validateBusinessCreate(single as Record<string, unknown>)
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    const created = await prisma.business.create({
      data: {
        ...(result.data as Record<string, unknown>),
        cityId:        await resolveCityId(session),
        submittedById: session.id,
        reviewedById:  session.id,
        reviewedAt:    new Date(),
        isApproved:    true,
        isActive:      true,
      } as never,
    })
    await writeAudit(
      session.id, session.name,
      'directory.create',
      created.id, 'business',
      { name: created.name },
    )
    return NextResponse.json({ ok: true, id: created.id })
  } catch (e) {
    console.error('Admin directory POST error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
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
      // submittedById is nullable (SetNull when the submitter deletes
      // their account); skip the notify on orphaned rows.
      if (existing.submittedById) {
        await createNotification(existing.submittedById, 'system',
          'Business listing approved!',
          `"${existing.name}" is now live in the Smileys directory.`,
          '/directory',
        )
      }
      await writeAudit(session.id, session.name, 'directory.approve', id, 'business', { name: existing.name })
      return NextResponse.json({ ok: true })
    }

    if (action === 'reject') {
      await prisma.business.update({
        where: { id },
        data: { isApproved: false, isActive: false, reviewedById: session.id, reviewedAt: new Date() },
      })
      if (existing.submittedById) {
        await createNotification(existing.submittedById, 'system',
          'Business listing not approved',
          `"${existing.name}" was not approved for the directory. Contact an admin for more info.`,
          '/directory',
        )
      }
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
    // Drop fields whose new value equals the existing one — admin
    // re-saving an unchanged form shouldn't bump updatedAt or fire an
    // audit-log entry.
    const data = dropUnchanged(result.data, existing as unknown as Record<string, unknown>)
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: true, unchanged: true })
    }

    const updated = await prisma.business.update({ where: { id }, data })
    await writeAudit(session.id, session.name, 'directory.update', id, 'business', {
      name: existing.name, fields: Object.keys(data),
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
