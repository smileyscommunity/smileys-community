import { describe, it, expect } from 'vitest'
import { isSafeHref } from '@/lib/safeUrl'

describe('isSafeHref (XSS scheme guard)', () => {
  it('allows https, mailto, and in-app relative paths', () => {
    expect(isSafeHref('https://example.com')).toBe(true)
    expect(isSafeHref('https://example.com/path?q=1')).toBe(true)
    expect(isSafeHref('mailto:hi@smileyscommunity.com')).toBe(true)
    expect(isSafeHref('/clubs/social')).toBe(true)
  })

  it('rejects dangerous schemes', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('data:text/html,<script>1</script>')).toBe(false)
    expect(isSafeHref('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeHref('file:///etc/passwd')).toBe(false)
    expect(isSafeHref('http://example.com')).toBe(false) // http (not https) not allowed
  })

  it('rejects scheme-spoofing via whitespace / control chars', () => {
    expect(isSafeHref(' javascript:alert(1)')).toBe(false)
    expect(isSafeHref('\tjavascript:alert(1)')).toBe(false)
    expect(isSafeHref('java\nscript:alert(1)')).toBe(false)
  })

  it('rejects protocol-relative URLs and empty/nullish input', () => {
    expect(isSafeHref('//evil.com')).toBe(false)
    expect(isSafeHref('')).toBe(false)
    expect(isSafeHref(null)).toBe(false)
    expect(isSafeHref(undefined)).toBe(false)
  })
})
