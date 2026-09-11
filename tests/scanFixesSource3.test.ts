import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('city-host grant', () => {
  const src = read('app/api/admin/cities/[id]/hosts/route.ts')
  it('refuses accounts that are not approved or are suspended', () => {
    expect(src).toMatch(/if \(user\.status !== 'approved'\)/)
    expect(src).toMatch(/user\.suspendedUntil && user\.suspendedUntil > new Date\(\)/)
  })
})

describe('pro waitlist', () => {
  const src = read('app/api/pro/waitlist/route.ts')
  it('a signed-in member can only enrol their own email', () => {
    expect(src).toMatch(/const cleanEmail = String\(session\?\.email \?\? email \?\? ''\)/)
  })
  it('a resubmission cannot rename the entry', () => {
    expect(src).toMatch(/where:\s*\{ email: cleanEmail \},\s*update: \{\},/)
  })
})

describe('member profile live signals', () => {
  const src = read('app/api/members/[id]/route.ts')
  it('gate the pulse note and both neighborhoods like the profile neighborhood', () => {
    expect(src).toMatch(/neighborhood: fullAccess \? activePulse\.neighborhood : null, note: fullAccess \? activePulse\.note : null/)
    expect(src).toMatch(/neighborhood: fullAccess \? activeHangout\.neighborhood : null/)
  })
})

describe('body shapes are checked before Prisma sees them', () => {
  it('reports: ids and text are strings, eventId must exist', () => {
    const src = read('app/api/reports/route.ts')
    expect(src).toMatch(/typeof reportedId !== 'string' \|\| !reportedId \|\| typeof reason !== 'string'/)
    expect(src).toMatch(/details != null && typeof details !== 'string'/)
    expect(src).toMatch(/eventId != null && \(typeof eventId !== 'string' \|\| !await prisma\.event\.findUnique/)
  })
  it('unblock: userId is a string', () => {
    const src = read('app/api/members/block/route.ts')
    const del = src.slice(src.indexOf('export async function DELETE'))
    expect(del).toMatch(/typeof userId !== 'string'/)
  })
  it('poll vote: both ids are strings', () => {
    expect(read('app/api/community-poll/route.ts')).toMatch(/typeof pollId !== 'string' \|\| !pollId \|\| typeof optionId !== 'string'/)
  })
  it('connection note: typed and capped on both write paths', () => {
    const src = read('app/api/connections/route.ts')
    expect(src.match(/note: typeof note === 'string' \? note\.trim\(\)\.slice\(0, 500\) \|\| null : null/g)).toHaveLength(2)
    expect(src).not.toMatch(/note: note\?\.trim\(\) \|\| null/)
  })
})

describe('forgot-password activation branch', () => {
  it('shares the per-account resend budget and stays silent when throttled', () => {
    const src = read('app/api/auth/forgot-password/route.ts')
    expect(src).toMatch(/user\.status === 'approved' && await rateLimit\(`activate-resend-user:\$\{user\.id\}`, 1, 15 \* 60_000\)/)
  })
})
