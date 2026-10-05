import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkCronAuth } from '@/lib/cronAuth'
import { recordCronRun } from '@/lib/cronHealth'
import { retentionWhere } from '@/lib/applicationRetention'

// The retention the privacy policy promises, which nothing implemented
// (rules in lib/applicationRetention). A deleted rejected application's photo
// loses its last reference; the nightly orphan-upload sweep removes it after
// its 48-hour grace.
//
// DRY RUN BY DEFAULT: it reports what it would do and changes nothing unless
// called with ?commit=1. Not on the crontab yet — scheduling it is a decision
// about deleting production data (2026-09-29: 0 rejected rows old enough, 676
// applications with device data older than 90 days).
//
// Auth: `Authorization: Bearer <CRON_SECRET>` (lib/cronAuth).

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied
  const commit = req.nextUrl.searchParams.get('commit') === '1'
  const where = retentionWhere()
  try {
    const [rejected, device] = await Promise.all([
      prisma.memberApplication.count({ where: where.rejected }),
      prisma.memberApplication.count({ where: where.deviceData }),
    ])
    if (!commit) return NextResponse.json({ dryRun: true, wouldDeleteRejected: rejected, wouldScrubDeviceData: device })

    const [deleted, scrubbed] = await prisma.$transaction([
      prisma.memberApplication.deleteMany({ where: where.rejected }),
      prisma.memberApplication.updateMany({ where: where.deviceData, data: { ipAddress: null, userAgent: null, fingerprint: null } }),
    ])
    await recordCronRun('sweep-application-retention', true)
    return NextResponse.json({ dryRun: false, deletedRejected: deleted.count, scrubbedDeviceData: scrubbed.count })
  } catch (e) {
    if (commit) await recordCronRun('sweep-application-retention', false, e)
    console.error('[sweep-application-retention]', e)
    return NextResponse.json({ error: 'Retention sweep failed' }, { status: 500 })
  }
}
