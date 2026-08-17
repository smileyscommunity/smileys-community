import { describe, it, expect } from 'vitest'
import { safeReturnPath } from '@/lib/safeUrl'

// /login reads `next` (pages with their own gate) or `from` (the (member)
// layout's redirect) and navigates there after authenticating. That is a
// redirect target chosen by whoever wrote the URL, so it must be an in-app
// path and nothing else — isSafeHref is the wrong check here because it also
// green-lights absolute https:// and mailto: URLs, which as a post-login
// destination is an open redirect.

describe('safeReturnPath', () => {
  it('accepts in-app paths, including the renew deep link the expiry email sends', () => {
    expect(safeReturnPath('/board/renew/abc123')).toBe('/board/renew/abc123')
    expect(safeReturnPath('/visiting/new?city=izmir')).toBe('/visiting/new?city=izmir')
    expect(safeReturnPath('/dashboard')).toBe('/dashboard')
  })

  it('rejects anything that leaves the app', () => {
    expect(safeReturnPath('https://evil.com')).toBeNull()
    expect(safeReturnPath('//evil.com')).toBeNull()          // protocol-relative
    expect(safeReturnPath('http://evil.com')).toBeNull()
    expect(safeReturnPath('mailto:x@y.com')).toBeNull()
    expect(safeReturnPath('javascript:alert(1)')).toBeNull()
  })

  it('rejects whitespace and control chars used for scheme spoofing', () => {
    expect(safeReturnPath('\tjavascript:alert(1)')).toBeNull()
    expect(safeReturnPath(' /dashboard')).toBeNull()
    expect(safeReturnPath('/dash board')).toBeNull()
  })

  it('refuses to send the user back to /login', () => {
    expect(safeReturnPath('/login')).toBeNull()
    expect(safeReturnPath('/login?from=/members')).toBeNull()
  })

  it('treats missing values as no destination', () => {
    expect(safeReturnPath(null)).toBeNull()
    expect(safeReturnPath(undefined)).toBeNull()
    expect(safeReturnPath('')).toBeNull()
    expect(safeReturnPath('dashboard')).toBeNull()   // not absolute
  })
})
