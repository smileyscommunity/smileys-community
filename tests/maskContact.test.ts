import { describe, it, expect } from 'vitest'
import { maskEmail, maskPhone, emailFor, maskRows } from '@/lib/admin/maskContact'

// Moderators see who a member is, not how to reach them outside the app —
// the rule the users roster already applied, now shared by the other
// moderator-reachable lists.
const admin = { id: 'a', name: 'A', email: 'a@x', role: 'admin', color: '' } as any
const mod   = { id: 'm', name: 'M', email: 'm@x', role: 'moderator', color: '', cityId: 'c1' } as any

describe('maskContact', () => {
  it('masks the local part and keeps the domain', () => {
    expect(maskEmail('yamanerim@gmail.com')).toBe('yam...@gmail.com')
    expect(maskEmail(null)).toBeNull()
    expect(maskPhone('+905551234567')).toBe('+905...67')
  })
  it('admins see the address, moderators the mask', () => {
    expect(emailFor(admin, 'x@y.z')).toBe('x@y.z')
    expect(emailFor(mod, 'x@y.z')).toBe('x@y.z'.slice(0, 1) + '...@y.z')
  })
  it('rewrites the nested person on each row for a moderator and leaves admins untouched', () => {
    const rows = [{ id: 1, user: { id: 'u', name: 'N', email: 'someone@x.io' } }, { id: 2, user: null }]
    expect(maskRows(mod, rows, 'user')[0].user).toEqual({ id: 'u', name: 'N', email: 'som...@x.io' })
    expect(maskRows(mod, rows, 'user')[1].user).toBeNull()
    expect(maskRows(admin, rows, 'user')).toBe(rows)
  })
})
