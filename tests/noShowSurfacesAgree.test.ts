import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// The policy is explained on four surfaces — the two check-in pages, the
// review queue and the member rules — and they drifted: /admin/checkin still
// told staff a no-show needed "most of the room checked in", a rule deleted
// on 2026-09-19, while /host/checkin next to it described the warning rule
// that replaced it. Staff and hosts reading the same roster were told
// different policies.

const src = (p: string) => readFileSync(p, 'utf-8')

const CHECKIN_PAGES = ['app/admin/checkin/page.tsx', 'app/host/checkin/page.tsx']

describe('every surface describes the rule that is actually running', () => {
  it.each(CHECKIN_PAGES)('%s does not cite the deleted scan threshold', page => {
    const t = src(page)
    for (const gone of ['most of the room', 'half the room', '50%', 'if the host ran check-in']) {
      expect(t).not.toContain(gone)
    }
  })

  it.each(CHECKIN_PAGES)('%s says what silence actually does — warned, or not', page => {
    const t = src(page)
    expect(t).toContain("a no-show if we told them they weren't checked in and they didn't reply")
    expect(t).toContain('attended if they never got that message')
  })

  it.each(CHECKIN_PAGES)('%s does not promise a check-in that the route refuses', page => {
    // Past attendanceSettlesAt the check-in route returns attendance_settled;
    // only a scan queued BEFORE the line replays. "A late arrival can still
    // be checked in" is true only until then, and now says so.
    expect(src(page)).toContain('A late arrival can still be checked in until then.')
  })

  it('the review queue and the member page agree with them', () => {
    // Warned-or-nothing is the whole rule; if any surface loses it, the
    // others are describing a different system.
    expect(src('components/AttendanceReviewList.tsx')).toContain('never told they weren’t checked in')
    expect(src('app/(member)/standing/page.tsx')).toContain('Nothing counts against you unless that message reached you')
  })
})
