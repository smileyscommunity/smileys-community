import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Admin panel review, "fix now" batch (2026-09-26).
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('1. moderators do not receive applicants\' private data', () => {
  const src = read('app/api/admin/applications/route.ts')
  it('non-admins get the masked rows', () => {
    expect(src).toContain('return NextResponse.json(isAdmin(session) ? applications : applications.map(forModerator))')
  })
  it('contact masked, IP/fingerprint hashed, device dropped, birthdate only while deciding', () => {
    expect(src).toContain('email:       maskEmail(a.email)')
    expect(src).toContain('phone:       maskPhone(a.phone)')
    expect(src).toContain('ipAddress:   opaque(a.ipAddress)')
    expect(src).toContain('fingerprint: opaque(a.fingerprint)')
    expect(src).toContain('userAgent:   null')
    expect(src).toContain("birthdate:   DECIDING.has(a.status) ? a.birthdate : null")
  })
})

describe('2. a guide editor cannot wipe the live guide', () => {
  it('Save waits for a successful load in both editors', () => {
    expect(read('app/admin/guide/page.tsx')).toContain('disabled={saving || !loaded || !dirty || !canEdit}')
    expect(read('app/admin/neighborhoods/[slug]/page.tsx')).toContain('if (!loaded || !dirty) return')
  })
  it('the server refuses an empty guide over a populated one', () => {
    expect(read('app/api/admin/guide/route.ts')).toContain('if (hadContent && !hasContent) {')
    expect(read('app/api/admin/neighborhoods/[slug]/route.ts')).toContain('if (substance(current) && !substance(')
  })
})

describe('3–4. attendee emails reach the right people once', () => {
  const noShows = read('app/api/admin/events/[id]/notify-noshows/route.ts')
  it('no-show notices go to settled no-shows with approved accounts, once each', () => {
    expect(noShows).toContain("where: { eventId: id, status: 'approved', attendance: 'no_show', user: { status: 'approved' } },")
    expect(noShows).toContain('claimOnce(`noshow-notice:${a.userId}:${id}`')
    expect(noShows).not.toContain('checkedIn: false')
  })
  it('remind-attendees skips banned and deleted accounts', () => {
    expect(read('app/api/admin/events/[id]/remind-attendees/route.ts')).toContain("where: { eventId: id, status: 'approved', user: { status: 'approved' } },")
  })
})

describe('5. a ban from the moderation queue is guarded like one from the users page', () => {
  it('asks for step-up, tells the member, and the button confirms', () => {
    const route = read('app/api/admin/moderation/[id]/route.ts')
    expect(route).toContain("if (action === 'ban') {\n      const stepUp = requireStepUp(session)")
    expect(route).toContain("createNotification(report.reportedId, 'rsvp', 'Your account has been suspended'")
    expect(read('app/admin/moderation/page.tsx')).toContain("if (!(await confirmToast(`Ban ${who}?")
  })
})

describe('6–7. application decisions keep notes and finish activation', () => {
  const src = read('app/api/admin/applications/route.ts')
  it('a note is written only when given; review stamps only on a decision', () => {
    expect(src).toContain("typeof note === 'string' && note.trim() ? { reviewNote: note.slice(0, 2000) } : {}")
    expect(src).not.toContain('reviewNote:    reviewNote    || null')
    expect(src).toContain('...(status !== undefined && status !== null ? { reviewedBy: session.id, reviewedAt: new Date() } : {}),')
    expect(read('app/admin/applications/page.tsx')).toContain("!apps.find(a => a.id === id)?.reviewNote ? 'Quick-rejected from queue (no note left)' : undefined")
  })
  it('approving again sends the activation link to a never-activated account', () => {
    expect(src).toContain('if (existing.password === null) await enrolAndActivate(existing)')
    expect(src).toContain('if (had) return')
  })
})
