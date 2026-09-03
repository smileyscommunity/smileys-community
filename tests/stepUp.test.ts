import { describe, it, expect } from 'vitest'
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

  it('returns a machine-readable code and an actionable message', async () => {
    const res = requireStepUp(u({ role: 'admin' }))
    const body = await res!.json()
    expect(body.code).toBe('totp_required')
    // The admin pages toast `error` verbatim — it must name the way out.
    expect(body.error).toMatch(/2FA|two-factor/i)
  })
})
