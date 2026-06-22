import { describe, it, expect } from 'vitest'
import { isAdmin, isAdminStrict, isModerator, isAdminOrModerator, isPartner } from '@/lib/access'
import type { SessionUser } from '@/lib/session'

// Minimal session factory — only role/totpVerified matter for these checks.
const u = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1', name: 'U', email: 'u@example.com', role: 'member', color: '#000', ...over,
})

describe('role access helpers', () => {
  it('isAdmin is true only for the admin role', () => {
    expect(isAdmin(u({ role: 'admin' }))).toBe(true)
    expect(isAdmin(u({ role: 'moderator' }))).toBe(false)
    expect(isAdmin(u({ role: 'member' }))).toBe(false)
  })

  it('isAdminStrict requires admin AND a verified 2FA session', () => {
    expect(isAdminStrict(u({ role: 'admin', totpVerified: true }))).toBe(true)
    expect(isAdminStrict(u({ role: 'admin', totpVerified: false }))).toBe(false)
    expect(isAdminStrict(u({ role: 'admin' }))).toBe(false) // undefined totpVerified
    expect(isAdminStrict(u({ role: 'moderator', totpVerified: true }))).toBe(false)
  })

  it('isModerator is true only for the moderator role', () => {
    expect(isModerator(u({ role: 'moderator' }))).toBe(true)
    expect(isModerator(u({ role: 'admin' }))).toBe(false)
    expect(isModerator(u({ role: 'member' }))).toBe(false)
  })

  it('isAdminOrModerator covers admin and moderator only', () => {
    expect(isAdminOrModerator(u({ role: 'admin' }))).toBe(true)
    expect(isAdminOrModerator(u({ role: 'moderator' }))).toBe(true)
    expect(isAdminOrModerator(u({ role: 'partner' }))).toBe(false)
    expect(isAdminOrModerator(u({ role: 'member' }))).toBe(false)
  })

  it('isPartner is true only for the partner role', () => {
    expect(isPartner(u({ role: 'partner' }))).toBe(true)
    expect(isPartner(u({ role: 'member' }))).toBe(false)
    expect(isPartner(u({ role: 'admin' }))).toBe(false)
  })
})
