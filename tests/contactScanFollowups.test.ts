import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Contact scan 2026-09-29, items 1–10.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const api  = read('app/api/contact/route.ts')
const form = read('app/contact/page.tsx')

describe('1 + 10: nothing a person sends is silently dropped, and drops are logged', () => {
  it('spam signals only flag the subject, on every topic', () => {
    expect(api).not.toContain('OFFER_TOPICS')
    expect(api).not.toMatch(/if \(spammy[^)]*\)\s*\{\s*return NextResponse\.json\(\{ ok: true \}\)/)
    expect(api).toContain("const reason = spamReason(message, email) ?? spamReason(name, email) ?? (fast ? 'sent within 5 seconds' : null)")
    expect(api).toContain("subject: `[Contact]${reason ? ` ⚠ check: ${reason}` : ''}")
  })
  it('the only silent drop is the honeypot, and it is logged', () => {
    expect(api.split('return NextResponse.json({ ok: true })').length - 1).toBe(2) // honeypot + the real success
    expect(api).toContain('console.warn(`[contact] dropped: honeypot filled')
    expect(api).toContain('const fast = !_t || Date.now() - Number(_t) < 5000')
    expect(api).toContain('console.warn(`[contact] flagged: ${reason}')
  })
})

describe('2: city guide tips', () => {
  it('guide is a real topic, and the guide link carries the city', () => {
    expect(api).toContain("guide:       'City guide tip',")
    expect(form).toContain("{ value: 'guide',       label: 'City guide tip',")
    expect(read('app/guide/GuideCTA.tsx')).toContain('href={`/contact?topic=guide&city=${encodeURIComponent(citySlug)}`}')
  })
})

describe('3: no silent truncation', () => {
  it('3,000 like the server; over the limit holds the button instead of cutting', () => {
    expect(form).toContain('const MAX_MESSAGE = 3000')
    expect(form).not.toContain('.slice(0, 1000)')
    expect(form).toContain('onChange={e => set(\'message\', e.target.value)}')
    expect(form).toContain('|| form.message.length > MAX_MESSAGE}')
  })
})

describe('4: no response times nobody measures', () => {
  it('no 24–48 hours, Monday to Friday or Instagram-for-urgent', () => {
    expect(form).not.toContain('24–48')
    expect(form).not.toContain('Monday to Friday')
    expect(form).not.toContain('For urgent matters')
  })
})

describe('5–7: members, the join card, the city', () => {
  it('members get their name and email filled; the join card is for guests only', () => {
    expect(form).toContain("email: prev.email || user.email || '',")
    expect(form).toContain('{!isLoggedIn && (')
  })
  it('no superlative; the apply link keeps the city', () => {
    expect(form).not.toContain('most vibrant')
    expect(form).toContain('href={citySlug ? `/apply?city=${encodeURIComponent(citySlug)}` : \'/apply\'}')
  })
  it('the city name comes from the cities list, and the sender sees it', () => {
    expect(form).not.toContain("charAt(0).toUpperCase()")
    expect(form).toContain("fetch('/app/api/cities')")
    expect(form).toContain('This message will be tagged with <strong className="text-gray-800">{cityName}</strong>.')
  })
})

describe('8: accessible form', () => {
  it('pressed chips in a labeled group, hidden decoration, announced errors, unreachable honeypot', () => {
    expect(form).toContain('<div role="group" aria-labelledby="ct-topic-label"')
    expect(form).toContain('aria-pressed={form.topic === t.value}')
    expect(form).toContain('<span aria-hidden="true" className="text-lg">{t.icon}</span>')
    expect(form).toContain('<div role="alert" className="bg-red-50')
    expect(form).toContain("<div aria-hidden=\"true\" style={{ position: 'absolute', left: '-9999px'")
    expect(form).not.toContain('text-gray-400')
  })
})

describe('9: server limits and subject', () => {
  it('name and email capped; subject is plain text; the hourly limit is spent only after a send', () => {
    expect(api).toContain('if (name.trim().length > 100) {')
    expect(api).toContain('if (email.trim().length > 254) {')
    expect(api).toContain('— ${plainName}`,')
    expect(api.indexOf('await rateLimit(rateKey, RATE_LIMIT, RATE_WINDOW_MS)')).toBeGreaterThan(api.indexOf('await getResend().emails.send({'))
  })
})
