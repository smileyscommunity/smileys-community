import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Defense in depth on top of `sameSite: 'lax'` cookies: every mutating API call
// must carry an Origin (or Referer) whose host matches the request's host.
// Same-origin browser fetches always satisfy this; cross-site form submissions
// and headless attackers without a forged Origin won't.

const PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function middleware(req: NextRequest) {
  if (!PROTECTED_METHODS.has(req.method)) return NextResponse.next()

  const host = req.headers.get('host')
  if (!host) {
    return NextResponse.json({ error: 'Missing Host header' }, { status: 400 })
  }

  // Prefer Origin (set on cross-site requests); fall back to Referer because
  // some same-origin requests omit Origin.
  const originHeader = req.headers.get('origin') ?? req.headers.get('referer')
  if (!originHeader) {
    return NextResponse.json({ error: 'Origin required' }, { status: 403 })
  }

  let originHost: string
  try {
    originHost = new URL(originHeader).host
  } catch {
    return NextResponse.json({ error: 'Invalid Origin' }, { status: 403 })
  }

  if (originHost !== host) {
    return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
