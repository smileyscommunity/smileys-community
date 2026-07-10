import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { canManageClubs } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { seedRegionalClubs } from '@/lib/regionalClubSeeding'

export const dynamic = 'force-dynamic'

// POST /api/admin/clubs/seed-regional
// Auto-join approved members to the regional Culture clubs matching their
// nationality. Body: { dryRun?: boolean, includeTurkey?: boolean }.
// dryRun defaults to true so the UI can preview net-new counts before writing.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManageClubs(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const dryRun        = body?.dryRun !== false   // preview unless explicitly false
  const includeTurkey = body?.includeTurkey === true

  try {
    const result = await seedRegionalClubs({ dryRun, includeTurkey })

    if (!dryRun && result.written) {
      await writeAudit(
        session.id, session.name, 'clubs.seed-regional', undefined, 'club',
        { netNew: result.netNew, includeTurkey: result.includeTurkey },
        `Seeded ${result.netNew} regional-club memberships from nationality${result.includeTurkey ? ' (incl. Turkey)' : ''}`,
      )
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('[seed-regional]', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Seeding failed' }, { status: 500 })
  }
}
