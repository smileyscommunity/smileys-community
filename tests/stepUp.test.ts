import { describe, it, expect, vi } from 'vitest'

// 2FA is not currently REQUIRED (ADMIN_2FA_REQUIRED is false in
// lib/totpPolicy.ts — turned off 2026-09-07), which would make every
// assertion below vacuously pass. Mock the policy on so these keep testing
// the enforcement logic itself; the last test covers the shipped-off state.
// If the flag goes back to true, this mock becomes a no-op and the suite
// still means exactly what it says.
vi.mock('@/lib/totpPolicy', () => ({ ADMIN_2FA_REQUIRED: true }))

import { requireStepUp } from '@/lib/stepUp'
import type { SessionUser } from '@/lib/session'

// Minimal session factory — only role/totpVerified matter here.
const u = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1', name: 'U', email: 'u@example.com', role: 'member', color: '#000', ...over,
})

describe('requireStepUp', () => {
  it('lets a 2FA-verified admin through', () => {
    expect(requireStepUp(u({ role: 'admin', totpVerified: true }))).toBeNull()
  })

  it('blocks an admin whose session never passed TOTP verify', () => {
    const res = requireStepUp(u({ role: 'admin', totpVerified: false }))
    expect(res?.status).toBe(403)
  })

  it('blocks an admin with no totpVerified at all (the migration default)', () => {
    // Legacy sessions minted before the column default to undefined, not
    // false. Fail closed, or the whole gate is decorative for exactly the
    // sessions most likely to be stale.
    expect(requireStepUp(u({ role: 'admin' }))?.status).toBe(403)
  })

  it('blocks non-admins even with a verified 2FA session', () => {
    expect(requireStepUp(u({ role: 'moderator', totpVerified: true }))?.status).toBe(403)
    expect(requireStepUp(u({ role: 'member', totpVerified: true }))?.status).toBe(403)
  })

  it('is a no-op for everyone while the policy is off (the shipped default)', async () => {
    // The state production actually runs in. Re-imports the module against a
    // false flag so this pins the disabled behaviour rather than assuming it.
    vi.resetModules()
    vi.doMock('@/lib/totpPolicy', () => ({ ADMIN_2FA_REQUIRED: false }))
    const { requireStepUp: unenforced } = await import('@/lib/stepUp')
    expect(unenforced(u({ role: 'admin' }))).toBeNull()
    expect(unenforced(u({ role: 'admin', totpVerified: false }))).toBeNull()
    vi.doUnmock('@/lib/totpPolicy')
    vi.resetModules()
  })

  it('returns a machine-readable code and an actionable message', async () => {
    const res = requireStepUp(u({ role: 'admin' }))
    const body = await res!.json()
    expect(body.code).toBe('totp_required')
    // The admin pages toast `error` verbatim — it must name the way out.
    expect(body.error).toMatch(/2FA|two-factor/i)
  })
})
