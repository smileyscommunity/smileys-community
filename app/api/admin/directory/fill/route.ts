import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { isPlaceholderDescription } from '@/lib/directoryFill'

// Admin > Directory > "Needs details": run scripts/fill-directory-listings.ts
// for one approved business from the admin, instead of over SSH.
//
//   GET  ?                 the approved, live listings still missing details
//   POST { id, write }     start the script for that one listing. write=false
//                          is the dry run (prints what it would store).
//   GET  ?job=<id>         the job's log so far, and whether it has finished
//
// The script is the one source of truth for what is researched, verified and
// stored (it only fills EMPTY fields, checks the website answers, and takes a
// cover from the venue's own og:image), so this route does not reimplement
// any of it: it starts the script as a child process and shows its output.
// Admin-only: every run is a paid web-research call.

export const dynamic = 'force-dynamic'

const JOB_DIR = join(tmpdir(), 'smileys-directory-fill')
const JOB_ID  = /^[a-f0-9]{16}$/
const CUID    = /^[a-z0-9]{20,32}$/
// A run that has not exited by now is stuck; stop showing it as running.
const MAX_RUN_MS = 10 * 60_000
const LOG_CAP    = 20_000

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const job = new URL(req.url).searchParams.get('job')
  if (job) {
    if (!JOB_ID.test(job)) return NextResponse.json({ error: 'Bad job id' }, { status: 400 })
    const logFile = join(JOB_DIR, `${job}.log`)
    if (!existsSync(logFile)) return NextResponse.json({ error: 'Unknown job' }, { status: 404 })
    const exitFile = join(JOB_DIR, `${job}.exit`)
    const finished = existsSync(exitFile)
    const timedOut = !finished && Date.now() - statSync(logFile).birthtimeMs > MAX_RUN_MS
    const log = readFileSync(logFile, 'utf8').slice(-LOG_CAP)
    return NextResponse.json({
      log,
      done: finished || timedOut,
      ok:   finished ? readFileSync(exitFile, 'utf8').trim() === '0' : false,
      ...(timedOut ? { error: 'The run took too long and was abandoned.' } : {}),
    })
  }

  const rows = await prisma.business.findMany({
    where: { isApproved: true, isActive: true, closedAt: null },
    select: {
      id: true, name: true, category: true, neighborhood: true, description: true, website: true,
      phone: true, hours: true, coverImage: true, reviewedAt: true, createdAt: true,
      city: { select: { name: true } },
    },
    orderBy: [{ reviewedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
  })
  const items = rows.map(b => {
    const missing = [
      b.category === 'Other'              && 'category',
      !b.coverImage                       && 'cover',
      isPlaceholderDescription(b.description) && 'description',
      !b.website                          && 'website',
      !b.hours                            && 'hours',
      !b.phone                            && 'phone',
    ].filter((x): x is string => !!x)
    return { id: b.id, name: b.name, category: b.category, neighborhood: b.neighborhood, city: b.city.name, approvedAt: b.reviewedAt ?? b.createdAt, missing }
  }).filter(b => b.missing.length > 0)
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body  = await req.json().catch(() => ({}))
  const id    = typeof body?.id === 'string' ? body.id : ''
  const write = body?.write === true
  if (!CUID.test(id)) return NextResponse.json({ error: 'Bad business id' }, { status: 400 })

  const biz = await prisma.business.findUnique({ where: { id }, select: { id: true, isApproved: true } })
  if (!biz) return NextResponse.json({ error: 'Business not found' }, { status: 404 })
  // Pending rows are researched from the CLI (--pending) on purpose: this tab
  // is for the step after approval.
  if (!biz.isApproved) return NextResponse.json({ error: 'Approve the business first' }, { status: 400 })

  // One run at a time: each is a web-research call plus a cover download, and
  // two writers on one row would race. Released when the child exits.
  const runKey = 'directory-fill'
  if (!(await claimOnce(runKey, MAX_RUN_MS))) {
    return NextResponse.json({ error: 'A run is already in progress — wait for it to finish.' }, { status: 409 })
  }

  try {
    mkdirSync(JOB_DIR, { recursive: true })
    const job     = randomBytes(8).toString('hex')
    const logFile = join(JOB_DIR, `${job}.log`)
    const fd      = openSync(logFile, 'a')
    const args    = [
      '--env-file=.env', '--env-file=.env.local',
      'scripts/fill-directory-listings.ts', '--id', id,
      ...(write ? ['--write'] : []),
    ]
    // No shell, and `id` is a validated cuid: nothing here is interpolated
    // into a command line.
    const child = spawn(join(process.cwd(), 'node_modules', '.bin', 'tsx'), args, {
      cwd: process.cwd(), stdio: ['ignore', fd, fd], detached: true,
    })
    closeSync(fd)
    const finish = (code: number | null) => {
      try { writeFileSync(join(JOB_DIR, `${job}.exit`), String(code ?? 1)) } catch { /* the log timeout covers it */ }
      void releaseClaim(runKey)
    }
    child.on('exit',  finish)
    child.on('error', e => {
      try { writeFileSync(logFile, `✗ Could not start the script: ${e.message}\n`, { flag: 'a' }) } catch { /* ignore */ }
      finish(1)
    })
    child.unref()
    return NextResponse.json({ job, write })
  } catch (e) {
    await releaseClaim(runKey)
    return NextResponse.json({ error: `Could not start: ${(e as Error).message}` }, { status: 500 })
  }
}
