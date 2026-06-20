let warnedNoKey = false

export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY

  if (!secret) {
    // Fail closed in production. Without the secret, Turnstile is effectively
    // disabled — which removes our only bot/CAPTCHA defense on login, register,
    // forgot-password, apply, appeal, and contact endpoints. A dropped env
    // var should NEVER silently turn off the protection.
    if (process.env.NODE_ENV === 'production') {
      console.error('[turnstile] TURNSTILE_SECRET_KEY is not set in production — refusing to verify (fail closed)')
      return false
    }
    // Dev/test: skip verification so local dev works without a real key, but
    // log once so developers notice the gap.
    if (!warnedNoKey) {
      console.warn('[turnstile] TURNSTILE_SECRET_KEY is not set — skipping verification (dev only)')
      warnedNoKey = true
    }
    return true
  }

  try {
    const body: Record<string, string> = { secret, response: token }
    if (ip) body.remoteip = ip
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const data = await res.json()
    return data.success === true
  } catch (err) {
    console.error('[turnstile] verification request failed:', err)
    return false
  }
}
