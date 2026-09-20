import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  thresholds, cutoffFor, requestReasons, dmReasons, pct,
  type RequestRow, type DmRow,
} from '@/lib/connectionAbuse'

// The weekly email scan and the live admin panel used to carry separate
// copies of these rules, and the panel's comment claimed parity it did not
// have: it flagged from 20 requests where the email flagged from 10, used an
// 80% skew bar against the email's 75%, fired on ANY one signal where the
// email required skew AND a volume signal, and had no DM scan at all. A
// moderator who checked the panel and saw nothing could not conclude
// all-clear. These guard the single source and the two call sites.

const t = thresholds(60)

const req = (over: Partial<RequestRow> = {}): RequestRow => ({
  userId: 'u1', name: 'Sender', gender: 'male', role: 'member', suspended: false,
  sent: 20, accepted: 1, pending: 15, toFemale: 19, toMale: 1, ...over,
})
const dm = (over: Partial<DmRow> = {}): DmRow => ({
  userId: 'u1', name: 'Sender', gender: 'male', suspended: false,
  partners: 10, toFemale: 9, toMale: 1, noReply: 8, ...over,
})

describe('thresholds', () => {
  it('are looser on a rolling window than all-time, because it sees fewer rows', () => {
    expect(thresholds(60).MIN_REQUESTS).toBe(10)
    expect(thresholds(60).MIN_DM_PARTNERS).toBe(6)
    expect(thresholds(0).MIN_REQUESTS).toBe(15)
    expect(thresholds(0).MIN_DM_PARTNERS).toBe(8)
  })
  it('WINDOW_DAYS=0 means all time, not "zero days ago"', () => {
    expect(cutoffFor(0).getTime()).toBe(0)
    expect(cutoffFor(60).getTime()).toBeLessThan(Date.now())
  })
})

describe('request flags', () => {
  it('flags the July 2026 pattern: skew plus an ignored backlog', () => {
    expect(requestReasons(req(), t)).toEqual(['gender-skew', 'low-acceptance', 'high-ignore'])
  })

  // The structural half of the drift. The panel's OR meant plain low
  // acceptance flagged a member with no targeting pattern at all.
  it('does NOT flag low acceptance on its own — skew is required with it', () => {
    expect(requestReasons(req({ toFemale: 10, toMale: 10, accepted: 0, pending: 0 }), t)).toEqual([])
  })
  it('does NOT flag skew on its own — plenty of accepted requests is networking', () => {
    expect(requestReasons(req({ accepted: 18, pending: 1 }), t)).toEqual([])
  })

  it('an unset gender spraying one gender is still caught, not exempted', () => {
    expect(requestReasons(req({ gender: null }), t)).toContain('gender-skew')
  })
  it('same-gender skew is friend-seeking, not trawling', () => {
    expect(requestReasons(req({ gender: 'female', toFemale: 19, toMale: 1 }), t)).toEqual([])
  })
  it('catches a member targeting men, which the old female-only rule could not', () => {
    expect(requestReasons(req({ gender: 'female', toFemale: 1, toMale: 19 }), t)).toContain('gender-skew')
  })

  it('needs a real sample before calling it skew', () => {
    expect(requestReasons(req({ sent: 12, toFemale: 8, toMale: 1 }), t)).toEqual([])
  })
  it('leaves hosts and moderators alone — fanning out is their job', () => {
    expect(requestReasons(req({ role: 'host' }), t)).toEqual([])
  })
  it('leaves an already-suspended member alone', () => {
    expect(requestReasons(req({ suspended: true }), t)).toEqual([])
  })
})

describe('DM flags', () => {
  it('flags one-way fan-out to one gender', () => {
    expect(dmReasons(dm(), t)).toEqual(['dm-skew', 'never-replied'])
  })
  it('drops never-replied when everyone wrote back', () => {
    expect(dmReasons(dm({ noReply: 0 }), t)).toEqual(['dm-skew'])
  })
  it('same-gender skew is not the pattern', () => {
    expect(dmReasons(dm({ gender: 'female' }), t)).toEqual([])
  })
  it('a mixed inbox is not skew', () => {
    expect(dmReasons(dm({ toFemale: 5, toMale: 5 }), t)).toEqual([])
  })
  it('unknown-gender partners count against the pattern, not as absent evidence', () => {
    // 5 of 10 partners have a known gender and all are women: against the
    // partner denominator that is 50%, under the bar.
    expect(dmReasons(dm({ toFemale: 5, toMale: 0 }), t)).toEqual([])
  })
})

describe('both callers read the shared module', () => {
  const script = readFileSync('scripts/scan-connection-abuse.ts', 'utf-8')
  const route  = readFileSync('app/api/admin/users/connection-flags/route.ts', 'utf-8')

  it.each([['script', script], ['route', route]])('%s imports the rules instead of restating them', (_n, src) => {
    expect(src).toMatch(/from '@\/lib\/connectionAbuse'/)
    expect(src).toMatch(/requestReasons/)
    expect(src).toMatch(/dmReasons/)
    expect(src).toMatch(/requestScanSql/)
    expect(src).toMatch(/dmScanSql/)
  })

  it.each([['script', script], ['route', route]])('%s declares no thresholds of its own', (_n, src) => {
    // The exact drift that happened: a second copy of a number.
    expect(src).not.toMatch(/MIN_SENT\s*=\s*\d/)
    expect(src).not.toMatch(/LOW_ACCEPTANCE\s*=\s*[\d.]/)
    expect(src).not.toMatch(/HIGH_IGNORE\s*=\s*[\d.]/)
    expect(src).not.toMatch(/GENDER_SKEW\s*=\s*[\d.]/)
    expect(src).not.toMatch(/MIN_REQUESTS\s*=\s*\d/)
    expect(src).not.toMatch(/MIN_DM_PARTNERS\s*=\s*\d/)
  })

  it('the route reports the DM half too — it used to have none', () => {
    expect(route).toMatch(/dmFlagged/)
  })

  it('neither caller mutates: this is a report, sanctions stay human', () => {
    for (const src of [script, route]) {
      expect(src).not.toMatch(/prisma\.user\.update/)
      expect(src).not.toMatch(/suspendedUntil:\s/)
    }
  })
})

describe('pct', () => {
  it('rounds, and does not divide by zero', () => {
    expect(pct(1, 3)).toBe(33)
    expect(pct(0, 0)).toBe(0)
  })
})
