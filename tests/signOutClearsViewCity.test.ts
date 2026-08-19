import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = {
  get:    vi.fn(),
  set:    vi.fn(),
  delete: vi.fn(),
}
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => store) }))
vi.mock('@/lib/prisma', () => ({ prisma: { session: { deleteMany: vi.fn(), update: vi.fn() } } }))

import { deleteSession } from '@/lib/session'
import { VIEW_CITY_COOKIE } from '@/lib/city'

// The view-city override is per-PERSON state kept in a per-BROWSER cookie, and
// nothing cleared it: it was written only by /api/city/enter and
// /api/me/view-city and survived sign-out. On a shared browser someone could
// look at Bodrum, sign out, and the next member to sign in landed in Bodrum
// rather than their own city, with no visible cause — the switcher was never
// touched. Nothing leaks (it only picks which city's public content renders;
// authorization is by session), but "sign in and land in my city" quietly
// fails, which is how it gets reported as "the city switcher is broken".

beforeEach(() => {
  vi.clearAllMocks()
  store.get.mockReturnValue(undefined)   // no JWT — skips the DB half entirely
})

const cookieSet = (name: string) =>
  store.set.mock.calls.find(c => c[0] === name)

describe('deleteSession', () => {
  it('clears the view-city override, so the next person gets their own city', async () => {
    await deleteSession()
    expect(cookieSet(VIEW_CITY_COOKIE)).toBeTruthy()
  })

  it('clears it by setting empty with maxAge 0, not delete() — a bare delete no-ops on iOS', async () => {
    // On https the original cookie is Secure, and a non-Secure Set-Cookie may
    // not overwrite a Secure one. /api/city/enter hit exactly this.
    await deleteSession()
    const [, value, opts] = cookieSet(VIEW_CITY_COOKIE)!
    expect(value).toBe('')
    expect(opts.maxAge).toBe(0)
    expect(opts.path).toBe('/')
    expect(store.delete).not.toHaveBeenCalledWith(VIEW_CITY_COOKIE)
  })

  it('still clears the session cookie itself', async () => {
    await deleteSession()
    expect(store.delete).toHaveBeenCalled()
  })

  it('still sets the sign-out reason when one is given', async () => {
    await deleteSession('suspended' as never)
    const reason = store.set.mock.calls.find(c => c[0] !== VIEW_CITY_COOKIE)
    expect(reason?.[1]).toBe('suspended')
  })

  it('survives a render context, where cookie writes throw', async () => {
    // getSession() calls this mid-render when a session turns out to be
    // suspended, banned or stale. The throw must not escape.
    store.delete.mockImplementationOnce(() => { throw new Error('Cookies can only be modified in a Server Action or Route Handler') })
    await expect(deleteSession()).resolves.not.toThrow()
  })
})
