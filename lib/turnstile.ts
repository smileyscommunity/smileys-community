export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return true // not configured — skip verification
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
  } catch { return false }
}
