import { createHmac, timingSafeEqual } from 'crypto'

/**
 * HMAC-SHA256 webhook signature verification helper. Covers the common
 * case where an inbound webhook (Stripe, Resend bounce, WhatsApp Business
 * delivery report, GitHub, etc.) signs the raw request body with a shared
 * secret and includes the hex digest in a header.
 *
 * Usage in a route handler:
 *
 *   const raw = await req.text()  // MUST use raw body, NOT req.json()
 *   const ok = verifyHmacSignature({
 *     rawBody: raw,
 *     signatureHex: req.headers.get('x-some-signature') ?? '',
 *     secret: process.env.SOME_WEBHOOK_SECRET,
 *   })
 *   if (!ok) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
 *
 *   const body = JSON.parse(raw)
 *   // ... process the event
 *
 * Things to watch out for when adding a new webhook:
 *
 *  - `req.json()` consumes the stream; you can only call `req.text()`
 *    once. The signature must be computed against the EXACT bytes the
 *    provider signed — re-serializing parsed JSON will fail because key
 *    order / whitespace differ.
 *
 *  - Some providers (Stripe especially) sign a string of the form
 *    `<timestamp>.<body>` and you check the timestamp is fresh. If
 *    that's the case, don't use this helper directly — use the
 *    provider's own SDK (`stripe.webhooks.constructEvent` etc.) which
 *    handles the replay window too.
 *
 *  - Fail closed when `secret` env is unset (returns false). Don't
 *    silently bypass the check — the failure mode is "all webhooks
 *    accepted" which is much worse than "all webhooks rejected".
 *
 *  - timingSafeEqual is used instead of `===` so signature comparison
 *    doesn't leak timing information.
 */
export function verifyHmacSignature(opts: {
  rawBody:      string
  signatureHex: string
  secret:       string | undefined
}): boolean {
  if (!opts.secret) return false
  if (!opts.signatureHex) return false

  const expected = createHmac('sha256', opts.secret)
    .update(opts.rawBody)
    .digest('hex')

  // Some providers ship the signature with a prefix (`sha256=...` or
  // `v1=...`). Strip a single `prefix=` if present so callers don't
  // have to remember.
  const got = opts.signatureHex.includes('=')
    ? opts.signatureHex.split('=').pop() ?? ''
    : opts.signatureHex

  // timingSafeEqual requires equal-length buffers. Length-mismatch
  // returns false immediately rather than throwing.
  if (got.length !== expected.length) return false

  try {
    return timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}
