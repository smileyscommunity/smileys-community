import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The Broadcasts review (2026-09-22), server side. One click here emails and
// notifies ~1,800 members and an email cannot be recalled — and the review
// found: any unrecognised audience quietly meant everyone; an admin had no
// send cap at all above a step-up gate that is switched off; a whole-
// membership email (~16 minutes of paced sends) always outlived nginx's 60s,
// so the sender was told "check Broadcast History before retrying" against a
// history that stayed empty until the very end; an edit rewrote what the
// community was told with no audit row; suspended members got the email the
// bell deliberately withheld; and "N sent" counted people who got nothing.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const route = src('app/api/admin/notifications/broadcast/route.ts')

describe('who a broadcast can reach', () => {
  it('is one of four named audiences, never a fall-through', () => {
    expect(route).toContain("const AUDIENCES = ['all', 'city', 'club', 'event'] as const")
    expect(route).toContain("return NextResponse.json({ error: 'Pick who this goes to' }, { status: 400 })")
    expect(route).toContain("const isGlobal = aud === 'all'")
    // The old shape: a bare else that selected every approved member.
    expect(route).not.toMatch(/const isGlobal = !\(\(audience/)
  })

  it('an id is an id — a filter object in its place is refused', () => {
    expect(route).toContain("return typeof v === 'string' ? v : undefined   // undefined = invalid")
    expect(route).toContain("if (cleanClubId === undefined || cleanEventId === undefined || cleanCityId === undefined) {")
    expect(route).toContain("if (aud === 'club'  && !cleanClubId)  return NextResponse.json({ error: 'Pick a club' },  { status: 400 })")
  })

  it('an empty audience is refused rather than reported as sent', () => {
    expect(route).toContain("return NextResponse.json({ error: 'That audience has nobody in it — nothing was sent' }, { status: 400 })")
  })

  it('the email honours a suspension the bell already honoured, and skips unverified addresses', () => {
    expect(route).toContain("? dedup.filter(u => u.emailMarketing && u.emailVerified && !recipientSkipReason(u, notifType))")
    expect(route).toContain("const willNotify = dedup.filter(u => !recipientSkipReason(u, notifType))")
  })
})

describe('how often', () => {
  it('an admin has a daily cap too — a stolen session could mail the membership in a loop', () => {
    expect(route).toContain('const ADMIN_SENDS_PER_DAY = 10')
    expect(route).toContain("const capKey   = isAdmin(session) ? `broadcast-admin:${session.id}` : `broadcast-mod:${session.id}`")
  })

  it("the day's send is spent after the audience is known, never on a database blip", () => {
    expect(route.indexOf('users = await prisma.user.findMany')).toBeLessThan(route.indexOf('rateLimit(capKey'))
  })

  it('a moderator can see what they have left without spending one', () => {
    const rl = src('lib/rateLimit.ts')
    expect(rl).toContain('export async function rateLimitRemaining(key: string, limit: number): Promise<number>')
    expect(rl).toContain('if (!row || row.expired) return limit')
    expect(route).toContain('return NextResponse.json({ history, sendsLeftToday })')
  })
})

describe('what the sender is told, and when', () => {
  it('the row is written BEFORE the fan-out and the answer is a 202', () => {
    const create  = route.indexOf('record = await prisma.broadcast.create({')
    const fanOut  = route.indexOf('const fanOut = async () => {')
    const respond = route.indexOf("}, { status: 202 })")
    expect(create).toBeGreaterThan(0)
    expect(create).toBeLessThan(fanOut)
    expect(fanOut).toBeLessThan(respond)
    expect(route).toContain('sentCount: 0, finishedAt: null },')
    expect(route).toContain('queued:        dedup.length,')
  })

  it('the counts land per channel when it finishes, and a broken fan-out is still stamped finished', () => {
    expect(route).toContain('data:  { emailedCount: emailed, notifiedCount: notified,')
    // Tracked by Next's after() where a request scope exists (production);
    // a bare floating promise only where there is none (a unit test).
    expect(route).toContain("function afterResponse(run: () => Promise<void>): void {")
    expect(route).toContain("try { after(run) } catch { void run() }")
    expect(route).toContain("afterResponse(() => fanOut().catch(async err => {")
    expect(route).toContain("await prisma.broadcast.update({ where: { id: record.id }, data: { finishedAt: new Date() } }).catch(() => {})")
  })

  it('the sender is kept by id, and the audit records the image', () => {
    expect(route).toContain('sentBy: session.name, sentById: session.id,')
    expect(route).toContain('cityId: aud === \'city\' ? cleanCityId : null, imageUrl: image,')
  })

  it('the migration is additive and nullable, and existing sends are finished ones', () => {
    const sql = src('prisma/migrations/20260922000002_broadcast_progress/migration.sql')
    for (const col of ['sentById', 'emailedCount', 'notifiedCount', 'finishedAt']) expect(sql).toContain(`ADD COLUMN "${col}"`)
    expect(sql).not.toMatch(/NOT NULL|DEFAULT/)
    // A null finishedAt means "still sending"; every row from before the
    // column existed is a finished send and would otherwise poll for ever.
    expect(sql).toContain('UPDATE "broadcasts" SET "finishedAt" = "createdAt" WHERE "finishedAt" IS NULL;')
  })
})

describe('editing what was said', () => {
  it('is audited, with before and after and how many copies moved', () => {
    expect(route).toContain("writeAudit(session.id, session.name, 'broadcast.edit', id, 'broadcast',")
    expect(route).toContain('before: { title: b.title, message: b.message, imageUrl: b.imageUrl },')
    expect(route).toContain('notificationsUpdated: rewritten.count, outsideWindow: rewritten.count === 0,')
  })

  it("says when members' copies were out of reach instead of reporting 0 as success", () => {
    expect(route).toContain('outsideWindow: rewritten.count === 0,')
    expect(route).toContain('rewritten:     rewritten.count,')
  })

  it('caps the text the same way a send does', () => {
    expect(route).toContain('const TITLE_MAX   = 150')
    expect(route).toContain('const MESSAGE_MAX  = 5_000')
    expect((route.match(/lengthError\(String\(title\)\.trim\(\), String\(message\)\.trim\(\)\)/g) ?? []).length).toBe(2)
  })
})

describe('the email itself', () => {
  it('carries the one-click unsubscribe headers the newsletter already sets', () => {
    const email = src('lib/email.ts')
    const fn = email.slice(email.indexOf('export async function sendBroadcastEmail'), email.indexOf("await send('sendBroadcastEmail'") + 600)
    expect(fn).toContain("'List-Unsubscribe':      `<${oneClickUnsubscribeUrl(userId)}>`,")
    expect(fn).toContain("'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',")
  })
})

describe('a rehearsal', () => {
  const test = src('app/api/admin/notifications/broadcast/test/route.ts')

  it('goes to the sender alone, writes no history row and takes no claim', () => {
    expect(test).toContain("await sendBroadcastEmail(session.id, me.email, me.name, `[TEST] ${cleanTitle}`, cleanMessage, image)")
    expect(test).toContain("await createNotification(session.id, notifType, `[TEST] ${cleanTitle}`")
    expect(test).not.toContain('broadcast.create')
    expect(test).not.toContain('claimOnce')
    expect(test).toContain('rateLimit(`broadcast-test:${session.id}`, 10, 60 * 60_000)')
  })

  it('applies the same image rule as a real send', () => {
    expect(test).toContain("if (cleanImage && !isUploadedImageUrl(cleanImage, ['broadcasts'])) {")
  })
})

describe('what is left on disk and in the database', () => {
  const sweep = src('app/api/cron/sweep-orphan-uploads/route.ts')

  it('the orphan sweep now reaps broadcasts/ — with BOTH reference columns', () => {
    expect(sweep).toContain("{ folder: 'broadcasts',   lastLook: [['broadcasts', 'imageUrl'], ['notifications', 'imageUrl']] },")
    expect(sweep).toContain("['broadcasts',          'imageUrl'],")
    expect(sweep).toContain("['notifications',       'imageUrl'],")
    // Per folder: the reference snapshot and the last look are both scoped.
    expect(sweep).toContain('async function loadReferences(folder: string)')
    expect(sweep).toContain("LIKE '%${folder}/%'")
  })

  it('a folder that does not exist yet is an empty pass, not a failed run', () => {
    expect(sweep).toContain("if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY, wouldDelete: [] }")
  })

  it('email failures — member addresses — are not kept for ever', () => {
    expect(sweep).toContain('const EMAIL_FAILURE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000')
    expect(sweep).toContain("prisma.emailFailure.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - EMAIL_FAILURE_RETENTION_MS) } } })")
    // Bookkeeping never fails the sweep.
    expect(sweep).toContain("console.error('[cron sweep-orphan-uploads] email_failures prune failed', String(e))")
  })
})
