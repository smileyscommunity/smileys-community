import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

vi.mock('@/lib/prisma', () => ({ prisma: {
  memberApplication: { findMany: vi.fn() },
  user:              { findMany: vi.fn() },
} }))

import { findStrandedApprovals } from '@/lib/hygieneSweeps'
import { prisma } from '@/lib/prisma'

// 2026-09-23. A member was approved on 2 June and her account sat at 'pending'
// for three and a half months. Nothing was broken in a way anything could see:
// the application said approved, the admin queue was empty, and only a query
// looking for something else found her. Approval writes two rows and nothing
// checked that the second one landed.

const p = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  p.memberApplication.findMany.mockResolvedValue([{ email: 'a@x.com' }, { email: 'b@x.com' }])
  p.user.findMany.mockResolvedValue([])
})

describe('an applicant told yes who cannot get in is reported', () => {
  it('finds a pending user behind an approved application', async () => {
    p.user.findMany.mockResolvedValue([{ id: 'u1' }])
    expect(await findStrandedApprovals()).toEqual({ count: 1, userIds: ['u1'] })
  })

  it('looks only at pending accounts — never at banned ones', async () => {
    // The dangerous version of this check is "make the user match the
    // application": a banned member's application usually still reads
    // approved, so that rule would un-ban them from a background job.
    await findStrandedApprovals()
    expect(p.user.findMany.mock.calls[0][0].where.status).toBe('pending')
    expect(JSON.stringify(p.user.findMany.mock.calls[0][0].where)).not.toContain('banned')
  })

  it('reads approved applications only, so a rejection is not a stranding', async () => {
    // Rejecting sets the user to 'pending' by design — enforced at login —
    // so a rejected applicant sitting there is the system working.
    expect(p.memberApplication.findMany.mock.calls.length).toBe(0)
    await findStrandedApprovals()
    expect(p.memberApplication.findMany.mock.calls[0][0].where).toEqual({ status: 'approved' })
  })

  it('says nothing when there is nothing to say', async () => {
    expect(await findStrandedApprovals()).toEqual({ count: 0, userIds: [] })
  })

  it('does not query users at all when no application is approved', async () => {
    p.memberApplication.findMany.mockResolvedValue([])
    expect(await findStrandedApprovals()).toEqual({ count: 0, userIds: [] })
    expect(p.user.findMany).not.toHaveBeenCalled()
  })
})

describe('it reports and never repairs', () => {
  it('the sweeper logs it as an error and returns the count', () => {
    const src = readFileSync(join(__dirname, '..', 'app/api/cron/sweep-name-hygiene/route.ts'), 'utf8')
    expect(src).toContain('stranded = await findStrandedApprovals()')
    expect(src).toContain("console.error('[cron sweep-name-hygiene] approved applicants whose account is still pending'")
    // No write path: a sweeper must not hand out access.
    expect(src).not.toMatch(/findStrandedApprovals[\s\S]{0,300}user\.update/)
  })

  it('and cannot take the sweep down with it', () => {
    // Found by an existing test rather than by me: an unmocked model made the
    // check throw, and the whole nightly sweep 500'd — name fixes and token
    // deletions already done, reported as a failed cron. A diagnostic must not
    // be able to fail the thing it is diagnosing.
    const src = readFileSync(join(__dirname, '..', 'app/api/cron/sweep-name-hygiene/route.ts'), 'utf8')
    expect(src).toMatch(/try \{\s*stranded = await findStrandedApprovals\(\)/)
    expect(src).toContain("stranded-approval check failed (sweep itself is fine)")
    // null, not 0: "we didn't look" must never read as "nothing to find".
    expect(src).toContain('strandedApprovals: stranded ? stranded.count : null')
  })

  it('and the helper itself performs no writes', () => {
    const lib = readFileSync(join(__dirname, '..', 'lib/hygieneSweeps.ts'), 'utf8')
    const fn = lib.slice(lib.indexOf('export async function findStrandedApprovals'))
    expect(fn).not.toContain('update')
    expect(fn).not.toContain('delete')
  })
})
