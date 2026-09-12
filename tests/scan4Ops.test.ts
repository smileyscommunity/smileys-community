import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, utimesSync, rmSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { createServer } from 'http'
import type { AddressInfo } from 'net'

// Fourth scan, ops findings: a lost reminder when its write failed after the
// claim, the sweep wrappers' logging (000000, no success line, a missing
// flock read as "still running"), two small UI states, one wrong comment, a
// comment-pinning test, and the applications/ upload folder that had no
// reaper referencing more than one column.

const read = (p: string) => readFileSync(p, 'utf-8')

const h = vi.hoisted(() => ({
  prisma: {
    notificationPreference: { findUnique: vi.fn(), findMany: vi.fn() },
    notification:           { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    rateLimit:              { deleteMany: vi.fn() },
    event:                  { updateMany: vi.fn(), findMany: vi.fn() },
    listing:                { updateMany: vi.fn(), findMany: vi.fn() },
    visitorAnnouncement:    { updateMany: vi.fn() },
    city:                   { findMany: vi.fn() },
    user:                   { findUnique: vi.fn() },
    $queryRaw:              vi.fn(),
    $queryRawUnsafe:        vi.fn(),
  },
  recordCronRun: vi.fn(async () => {}),
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/push', () => ({ sendPushToUser: vi.fn(async () => {}) }))
vi.mock('@/lib/cronHealth', () => ({ recordCronRun: h.recordCronRun }))

beforeEach(() => {
  vi.clearAllMocks()
})

// ── 1. createNotification reports; the reminders sweep hands a failed claim back
describe('1 createNotification result', () => {
  it('true when the row is written, false when the write throws — never throws itself', async () => {
    const { createNotification } = await import('@/lib/notify')
    h.prisma.notification.create.mockResolvedValueOnce({ id: 'n1' })
    await expect(createNotification('u1', 'rsvp', 't', 'b')).resolves.toBe(true)
    h.prisma.notification.create.mockRejectedValueOnce(new Error('connection reset'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(createNotification('u1', 'rsvp', 't', 'b')).resolves.toBe(false)
  })

  it('a muted type is handled (true), not a failure to retry', async () => {
    const { createNotification } = await import('@/lib/notify')
    h.prisma.notificationPreference.findUnique.mockResolvedValueOnce({ reminders: false, quietHours: false })
    await expect(createNotification('u1', 'reminder_24h', 't', 'b', '/events/e1')).resolves.toBe(true)
    expect(h.prisma.notification.create).not.toHaveBeenCalled()
  })

  it('a bundled attendee_joined counts as written', async () => {
    const { createNotification } = await import('@/lib/notify')
    h.prisma.notificationPreference.findUnique.mockResolvedValueOnce(null)
    h.prisma.notification.findFirst.mockResolvedValueOnce({ id: 'n0', title: 'Ana joined', body: 'Ana joined "Walk"' })
    h.prisma.notification.update.mockResolvedValueOnce({})
    await expect(createNotification('u1', 'attendee_joined', 't', 'b', '/events/e1')).resolves.toBe(true)
  })
})

describe('1 releaseClaim', () => {
  it('deletes the rate_limits row by key and swallows a failure', async () => {
    const { releaseClaim } = await import('@/lib/rateLimit')
    h.prisma.rateLimit.deleteMany.mockResolvedValueOnce({ count: 1 })
    await releaseClaim('reminder-24h:u1:e1')
    expect(h.prisma.rateLimit.deleteMany).toHaveBeenCalledWith({ where: { key: 'reminder-24h:u1:e1' } })
    h.prisma.rateLimit.deleteMany.mockRejectedValueOnce(new Error('down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(releaseClaim('k')).resolves.toBeUndefined()
  })
})

describe('1 reminders sweep releases the claim when the write failed', () => {
  const notifyResult: Record<string, boolean> = {}
  const createNotification = vi.fn(async (_u: string, type: string) => notifyResult[type] ?? true)
  const claimOnce = vi.fn(async () => true)
  const releaseClaim = vi.fn(async () => {})
  const sendReviewRequestEmail = vi.fn(async () => {})

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/notify', () => ({ createNotification }))
    vi.doMock('@/lib/rateLimit', () => ({ claimOnce, releaseClaim }))
    vi.doMock('@/lib/email', () => ({ sendReviewRequestEmail, sendListingExpiryEmail: vi.fn(async () => {}), recordEmailFailure: vi.fn(async () => {}) }))
    vi.doMock('@/lib/session', () => ({ getSession: vi.fn(async () => null) }))
    vi.doMock('@/lib/city', () => ({ citiesByToday: vi.fn(async () => [{ date: '2026-09-13', cityIds: ['c1'] }]) }))
    vi.doMock('@/lib/eventTime', () => ({ eventStartsAt: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }))
    vi.doMock('@/lib/noShowPolicy', () => ({ noShowPolicyApplies: () => false, NO_SHOW_CANCELLATION_CUTOFF_HOURS: 12 }))
    for (const k of Object.keys(notifyResult)) delete notifyResult[k]
    process.env.CRON_SECRET = 'cron-test-secret'

    h.prisma.event.updateMany.mockResolvedValue({ count: 0 })
    h.prisma.listing.updateMany.mockResolvedValue({ count: 0 })
    h.prisma.visitorAnnouncement.updateMany.mockResolvedValue({ count: 0 })
    h.prisma.listing.findMany.mockResolvedValue([])
    h.prisma.notification.findMany.mockResolvedValue([])
    h.prisma.notificationPreference.findMany.mockResolvedValue([])
    h.prisma.city.findMany.mockResolvedValue([{ id: 'c1', timezone: 'Europe/Istanbul' }])
    h.prisma.event.findMany.mockImplementation(async ({ where }: { where: { status: unknown } }) => {
      if (where.status === 'archived') return []
      if (where.status === 'published') return [{ id: 'e1', title: 'Walk', time: '19:00', cityId: 'c1', attendees: [{ userId: 'u1' }] }]
      return [{ id: 'p1', title: 'Picnic', emoji: '🧺', cityId: 'c1', attendees: [{ user: { id: 'u2', name: 'Ana', email: 'ana@example.com' } }] }]
    })
  })
  afterEach(() => {
    vi.doUnmock('@/lib/notify'); vi.doUnmock('@/lib/rateLimit'); vi.doUnmock('@/lib/email'); vi.doUnmock('@/lib/session')
    vi.doUnmock('@/lib/city'); vi.doUnmock('@/lib/eventTime'); vi.doUnmock('@/lib/noShowPolicy')
    delete process.env.CRON_SECRET
  })

  async function run() {
    const { GET } = await import('@/app/api/admin/cron/reminders/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/app/api/admin/cron/reminders', { headers: { 'x-cron-secret': 'cron-test-secret' } }))
    return res.json()
  }

  it('a failed 24h write releases its claim and is not counted', async () => {
    notifyResult.reminder_24h = false
    const out = await run()
    expect(out.sent24h).toBe(0)
    expect(releaseClaim).toHaveBeenCalledWith('reminder-24h:u1:e1')
  })

  it('a written 24h reminder keeps its claim', async () => {
    const out = await run()
    expect(out.sent24h).toBe(1)
    expect(releaseClaim).not.toHaveBeenCalledWith('reminder-24h:u1:e1')
  })

  it('a failed review request releases its claim and holds the email for the retry', async () => {
    notifyResult.review_request = false
    const out = await run()
    expect(out.sentReviews).toBe(0)
    expect(releaseClaim).toHaveBeenCalledWith('review:u2:p1')
    expect(sendReviewRequestEmail).not.toHaveBeenCalled()
  })

  it('still claims before it writes (what stops two runs double-sending)', () => {
    const src = read('app/api/admin/cron/reminders/route.ts')
    for (const [claim, type] of [['claim24', 'reminder_24h'], ['claim2', 'reminder_2h'], ['reviewClaim', 'review_request'], ['connClaim', 'connection_suggestion'], ['expiryClaim', 'listing_expiry']]) {
      const c = src.indexOf(`claimOnce(${claim}`)
      const w = src.indexOf(`'${type}'`, c)
      expect(c, claim).toBeGreaterThan(-1)
      expect(w, type).toBeGreaterThan(c)
      expect(src.indexOf(`releaseClaim(${claim})`, w), claim).toBeGreaterThan(w)
    }
  })
})

// ── 2. sweep wrappers + deploy health check
describe('2 sweep wrappers', () => {
  const wrappers = readdirSync('scripts').filter(f => /^sweep-.*\.sh$/.test(f))

  it('covers every wrapper, including the new one', () => {
    expect(wrappers).toContain('sweep-orphan-uploads.sh')
  })

  it.each(wrappers)('%s: flock checked before use, exactly-000 fallback, success summary', (f) => {
    const src = read(`scripts/${f}`)
    const guard = src.indexOf('command -v flock >/dev/null || { echo "flock missing" >&2; exit 1; }')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(src.search(/^flock -n 9 \|\|/m))
    expect(src.search(/^flock -n 9 \|\|/m)).toBeGreaterThan(-1)
    expect(src).not.toContain('|| echo 000')
    if (src.includes('curl ')) {
      expect(src).toMatch(/"\$ENDPOINT"\) \|\| CODE=000/)
      expect(src).toMatch(/else\n\s*echo "\$\(date -u \+%FT%TZ\) OK HTTP \$CODE: \$\(tr -s '\\r\\n\\t' ' {3}' < "\$OUT" 2>\/dev\/null \| head -c 300\)"\nfi/)
    }
  })

  // Run the real wrapper against a real socket. flock is stubbed (macOS has
  // none); curl, grep, sed and friends are the system's.
  const scratch = mkdtempSync(join(tmpdir(), 'scan4ops-wrapper-'))
  const stubBin = join(scratch, 'bin')
  mkdirSync(stubBin)
  writeFileSync(join(stubBin, 'flock'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(stubBin, 'flock'), 0o755)
  const envFile = join(scratch, '.env')
  writeFileSync(envFile, 'CRON_SECRET="s3cret"\n')
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  const runWrapper = (env: Record<string, string>) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile('/bin/bash', ['scripts/sweep-orphan-uploads.sh'], { env, timeout: 20_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    })
  })

  it('a connection failure logs HTTP 000, not 000000', async () => {
    const probe = createServer()
    await new Promise<void>(r => probe.listen(0, '127.0.0.1', r))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>(r => probe.close(() => r()))   // nothing listens there now
    const out = await runWrapper({ PATH: `${stubBin}:${process.env.PATH}`, SMILEYS_ENV_FILE: envFile, SMILEYS_SWEEP_ENDPOINT: `http://127.0.0.1:${port}/app/api/cron/sweep-orphan-uploads` })
    expect(out.code).toBe(0)
    expect(out.stdout).toMatch(/FAILED HTTP 000: /)
    expect(out.stdout).not.toContain('000000')
  })

  it('a 2xx appends a one-line summary of the body', async () => {
    let auth = ''
    const server = createServer((req, res) => {
      auth = String(req.headers.authorization)
      res.writeHead(200, { 'content-type': 'application/json' })
      // Newlines and indentation squeeze to single spaces; the long run of
      // non-space filler is what the 300-char cut has to stop before TAIL.
      res.end('{\n  "ok": true,\n  "deleted": 3\n}' + 'x'.repeat(400) + 'TAIL')
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    try {
      const out = await runWrapper({ PATH: `${stubBin}:${process.env.PATH}`, SMILEYS_ENV_FILE: envFile, SMILEYS_SWEEP_ENDPOINT: `http://127.0.0.1:${port}/app/api/cron/sweep-orphan-uploads` })
      expect(out.code).toBe(0)
      expect(auth).toBe('Bearer s3cret')
      const lines = out.stdout.trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/OK HTTP 200: \{ "ok": true, "deleted": 3 \}x+$/)
      expect(lines[0]).not.toContain('TAIL')
    } finally {
      await new Promise<void>(r => server.close(() => r()))
    }
  })

  it('a missing flock fails loudly instead of skipping forever', async () => {
    const empty = join(scratch, 'empty-bin')
    mkdirSync(empty, { recursive: true })
    const out = await runWrapper({ PATH: empty, SMILEYS_ENV_FILE: envFile })
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('flock missing')
    expect(out.stdout).not.toContain('skipped')
  })
})

describe('2 deploy.sh', () => {
  const src = read('deploy.sh')
  it('health check falls back to exactly 000', () => {
    expect(src).not.toContain('|| echo 000')
    expect(src).toMatch(/HEALTH_CODE=\$\(ssh [^\n]*2>\/dev\/null\) \|\| HEALTH_CODE=000/)
  })
  it('registers the orphan-upload reaper nightly like the other sweepers, on a free slot', () => {
    expect(src).toContain('chmod +x $REMOTE/scripts/sweep-orphan-uploads.sh')
    expect(src).toContain("(crontab -l 2>/dev/null | grep -v 'sweep-orphan-uploads' ; echo '17 4 * * * $REMOTE/scripts/sweep-orphan-uploads.sh >> /var/log/sweep-orphan-uploads.log 2>&1') | crontab -")
    // Live registrations only (the retired cup lines are commented out).
    const others = [...src.matchAll(/^\(crontab -l[^\n]*echo '([^']+?) \$REMOTE\/scripts\/([\w-]+)\.sh/gm)]
      .filter(m => m[2] !== 'sweep-orphan-uploads').map(m => m[1].split(' ').slice(0, 2))
    expect(others.length).toBeGreaterThan(10)
    for (const [min, hour] of others) {
      expect(min === '17' && (hour === '4' || hour === '*'), `${min} ${hour}`).toBe(false)
    }
    // The */5 and */15 sweepers never land on :17.
    expect(17 % 5).not.toBe(0)
  })
})

// ── 3, 4, 5, 6 — copy, form state, comment, the comment-pinning test
describe('3 settings copy', () => {
  it('the joinedEvents toggle names hangouts too', () => {
    expect(read('app/(member)/settings/page.tsx')).toContain('description="When someone joins your event or hangout"')
  })
})

describe('4 host edit status select', () => {
  const src = read('app/host/events/[id]/edit/page.tsx')
  it('offers Published by the status loaded from the server, not the live form value', () => {
    expect(src).toMatch(/setLoadedStatus\(event\.status \?\? 'published'\)/)
    expect(src).toContain(`{(loadedStatus === 'published' || isStaff) && <option value="published">Published (live)</option>}`)
    expect(src).toContain(`{loadedStatus === 'pending' ? (`)
    expect(src).not.toMatch(/form\.status === 'published' \|\|/)
    expect(src).not.toMatch(/\{form\.status === 'pending' \?/)
  })
  it('the API still refuses a host moving an unpublished event to published', () => {
    expect(read('app/api/admin/events/[id]/route.ts')).toMatch(/if \(rest\.status === 'published' && before\.status !== 'published'\)/)
  })
})

describe('5 newsletter stuck-sweep comment', () => {
  it('no longer claims sentAt is the claim time for scheduled issues', () => {
    const src = read('app/api/cron/sweep-newsletters/route.ts')
    expect(src).not.toMatch(/claim time for every path/)
    expect(src).toMatch(/a SCHEDULED issue keeps its creation time/)
  })
})

describe('6 BoardFeed pin asserts code', () => {
  it('thirdScanFixes3 no longer matches the comment text', () => {
    const src = read('tests/thirdScanFixes3.test.ts')
    expect(src).not.toContain('not "Loading…" forever')
    expect(src).toContain(String.raw`['components/BoardFeed.tsx', /\} catch \{\s*setReplies\(\[\]\)/],`)
  })
})

// ── 7. orphan applicant-photo reaper
describe('7 sweep-orphan-uploads', () => {
  const routeSrc = read('app/api/cron/sweep-orphan-uploads/route.ts')
  const DAY = 24 * 60 * 60 * 1000
  let root = ''
  let dir = ''
  let rowsByTable: Record<string, string[]> = {}

  const touch = (name: string, ageMs: number) => {
    const p = join(dir, name)
    writeFileSync(p, 'x')
    const t = (Date.now() - ageMs) / 1000
    utimesSync(p, t, t)
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'scan4ops-uploads-'))
    dir = join(root, 'applications')
    mkdirSync(dir)
    process.env.UPLOAD_DIR = root
    process.env.CRON_SECRET = 'cron-test-secret'
    rowsByTable = {}
    h.prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      const table = sql.match(/FROM "([\w]+)"/)![1]
      return (rowsByTable[table] ?? []).map(v => ({ v }))
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    delete process.env.UPLOAD_DIR
    delete process.env.CRON_SECRET
  })

  async function post(query = '', body?: unknown) {
    const { POST } = await import('@/app/api/cron/sweep-orphan-uploads/route')
    const { NextRequest } = await import('next/server')
    const res = await POST(new NextRequest(`http://localhost/app/api/cron/sweep-orphan-uploads${query}`, {
      method: 'POST',
      headers: { authorization: 'Bearer cron-test-secret', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }))
    return { status: res.status, json: await res.json() }
  }

  function seed() {
    touch('100-orphan.jpg', 3 * DAY)
    touch('200-app.jpg', 3 * DAY)
    touch('300-avatar.jpg', 3 * DAY)
    touch('400-listing.jpg', 3 * DAY)
    touch('500-guide.JPG', 3 * DAY)
    touch('600-fresh.jpg', 2 * 60 * 60 * 1000)
    touch('notes.txt', 30 * DAY)
    mkdirSync(join(dir, 'nested'))
    rowsByTable.member_applications = ['/app/api/files/applications/200-app.jpg']
    rowsByTable.users = ['/app/uploads/applications/300-avatar.jpg']
    rowsByTable.listings = ['{/app/api/files/listings/a.jpg,/app/api/files/applications/400-listing.jpg}']
    rowsByTable.guide_entries = ['{"blocks": [{"src": "/app/api/files/applications/500-guide.jpg"}]}']
  }

  it('refuses without the cron secret', async () => {
    const { POST } = await import('@/app/api/cron/sweep-orphan-uploads/route')
    const { NextRequest } = await import('next/server')
    const res = await POST(new NextRequest('http://localhost/app/api/cron/sweep-orphan-uploads', { method: 'POST' }))
    expect(res.status).toBe(403)
  })

  it('deletes only old files no column references', async () => {
    seed()
    const { status, json } = await post()
    expect(status).toBe(200)
    expect(json).toMatchObject({ dryRun: false, deleted: 1, eligible: 1, referenced: 4, tooNew: 1, skippedUnrecognised: 2, failed: 0, deferred: 0 })
    expect(existsSync(join(dir, '100-orphan.jpg'))).toBe(false)
    for (const kept of ['200-app.jpg', '300-avatar.jpg', '400-listing.jpg', '500-guide.JPG', '600-fresh.jpg', 'notes.txt', 'nested']) {
      expect(existsSync(join(dir, kept)), kept).toBe(true)
    }
    expect(h.recordCronRun).toHaveBeenCalledWith('sweep-orphan-uploads', true)
  })

  it('?dryRun=1 lists what it would delete and deletes nothing', async () => {
    seed()
    const { json } = await post('?dryRun=1')
    expect(json).toMatchObject({ dryRun: true, deleted: 0, eligible: 1, wouldDelete: ['100-orphan.jpg'] })
    expect(existsSync(join(dir, '100-orphan.jpg'))).toBe(true)
    expect(h.recordCronRun).not.toHaveBeenCalled()
  })

  it('a JSON body { dryRun: true } is a dry run too', async () => {
    seed()
    const { json } = await post('', { dryRun: true })
    expect(json.dryRun).toBe(true)
    expect(existsSync(join(dir, '100-orphan.jpg'))).toBe(true)
  })

  it('a failed reference query deletes nothing', async () => {
    seed()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('"audit_logs"')) throw new Error('statement timeout')
      return []
    })
    const { status } = await post()
    expect(status).toBe(500)
    expect(existsSync(join(dir, '100-orphan.jpg'))).toBe(true)
    expect(existsSync(join(dir, '200-app.jpg'))).toBe(true)
    expect(h.recordCronRun).toHaveBeenCalledWith('sweep-orphan-uploads', false, expect.any(Error))
  })

  it('caps deletions per run at 500', async () => {
    for (let i = 0; i < 503; i++) touch(`${1000 + i}-x.jpg`, 3 * DAY)
    const { json } = await post()
    expect(json).toMatchObject({ deleted: 500, eligible: 503, deferred: 3 })
    expect(readdirSync(dir)).toHaveLength(3)
  })

  it('a missing applications folder is an empty run', async () => {
    rmSync(dir, { recursive: true })
    const { status, json } = await post()
    expect(status).toBe(200)
    expect(json).toMatchObject({ scanned: 0, deleted: 0 })
  })

  it('every reference column exists in prisma/schema.prisma (table as @@map, column as field)', () => {
    const schema = read('prisma/schema.prisma')
    const tables = new Map<string, Set<string>>()
    for (const block of schema.matchAll(/^model \w+ \{\n([\s\S]*?)^\}/gm)) {
      const map = block[1].match(/@@map\("([^"]+)"\)/)?.[1]
      if (!map) continue
      tables.set(map, new Set([...block[1].matchAll(/^\s+(\w+)\s+(?:String|Json)/gm)].map(m => m[1])))
    }
    const list = routeSrc.slice(routeSrc.indexOf('const REFERENCE_COLUMNS'), routeSrc.indexOf(']\n', routeSrc.indexOf('const REFERENCE_COLUMNS')))
    const pairs = [...list.matchAll(/\['(\w+)',\s*'(\w+)'\]/g)].map(m => [m[1], m[2]])
    expect(pairs.length).toBeGreaterThanOrEqual(31)
    expect(pairs).toContainEqual(['member_applications', 'profilePhoto'])
    expect(pairs).toContainEqual(['users', 'profilePhoto'])
    for (const [t, c] of pairs) expect(tables.get(t)?.has(c), `${t}.${c}`).toBe(true)
  })

  it('reads and deletes only inside applications/, and says member folders are out of scope', () => {
    expect(routeSrc).toContain("join(uploadRoot(), 'applications')")
    expect(routeSrc).toMatch(/Out of scope: the member upload folders/)
    expect(read('app/api/admin/cron/reminders/route.ts')).not.toMatch(/unlinkSync|readdirSync|purgedPhotos/)
  })
})
