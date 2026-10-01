import { NextRequest, NextResponse } from 'next/server'
import { recordCronRun } from '@/lib/cronHealth'
import { checkCronAuth } from '@/lib/cronAuth'
import { runSourceWatch } from '@/lib/handbookSources'

// Weekly: re-read every official page the Handbook cites and stamp the ones
// that changed (lib/handbookSources). Triggered by
// scripts/sweep-handbook-sources.sh from the server crontab (deploy.sh).
export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied
  try {
    const result = await runSourceWatch()
    await recordCronRun('sweep-handbook-sources', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-handbook-sources]', e)
    await recordCronRun('sweep-handbook-sources', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
