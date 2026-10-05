import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Advertise scan 2026-09-29, items 1–9.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page = read('app/advertise/page.tsx')
const form = read('app/advertise/AdvertiseFormClient.tsx')
const api  = read('app/api/advertise/route.ts')

describe('advertise page', () => {
  it('1: measured stats, never the admin rows', () => {
    expect(page).not.toContain('resolveStats')
    expect(page).toContain("{ value: nationalities,     label: 'Nationalities' },")
  })
  it('2: event sponsorship describes the real rooms', () => {
    expect(page).not.toContain('(30–80 attendees)')
    expect(page).toContain('from small tables to our biggest nights of 30–70 people')
  })
  it('3: no "Most popular" badge', () => {
    expect(page).not.toContain('Most popular')
  })
  it('4: no implied client list', () => {
    expect(page).not.toContain('Industries we work with')
    expect(page).toContain('Industries that fit our members')
  })
  it('5: no unverified open rate', () => {
    expect(page).not.toContain('average open rate')
  })
  it('6: audience lines are measured', () => {
    expect(page).toContain("value: `English-first, ${nationalities} nationalities`")
    expect(page).toContain("value: `${istanbulShare}% Istanbul-based`")
    expect(page).toContain("value: `${hosts} club hosts running events and activities`")
    expect(page).not.toContain('80% Istanbul-based')
  })
  it('7: no reply-time promise', () => {
    expect(page).not.toContain('48 hours')
    expect(form).not.toContain('48 hours')
  })
  it('8: a fast inquiry is flagged, not dropped; only the honeypot drops, logged', () => {
    expect(api).toContain("const fast = !_t || Date.now() - Number(_t) < 5000")
    expect(api).toContain("${fast ? ' ⚠ check: sent within 5 seconds' : ''}")
    // The honeypot is the only silent { ok: true }; the timing check no longer returns.
    expect(api.split('return NextResponse.json({ ok: true })').length - 1).toBe(1)
    expect(api).not.toMatch(/< 5000\) \{\s*return/)
    expect(api).toContain("console.warn('[advertise] dropped: honeypot filled')")
  })
  it('9: readable on amber, labeled form, hidden decoration', () => {
    expect(page).toContain('<dl className="grid grid-cols-1 sm:grid-cols-4 gap-10 sm:gap-8 text-center text-amber-950">')
    expect(page).not.toContain('text-amber-100')
    expect(page).not.toContain('text-gray-400')
    expect(form).toContain('<label htmlFor="ad-name"')
    expect(form).toContain('aria-pressed={form.format === f.value}')
    expect(form).toContain('<div role="alert"')
  })
})
