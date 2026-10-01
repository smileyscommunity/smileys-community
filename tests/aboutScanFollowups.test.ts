import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// About scan 2026-09-29, items 1–10.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page = read('app/about/page.tsx')

describe('about page', () => {
  it('1: the hero alt describes the picture without calling the people members', () => {
    expect(page).not.toContain('alt="Smileys members gathered')
    expect(page).toContain('alt="Friends talking on a rooftop at sunset over Istanbul, with Galata Tower and the Bosphorus behind them"')
  })
  it('2 + 6: measured stats, never the admin rows (one shared events figure via eventsStat, no WhatsApp reach)', () => {
    expect(page).not.toContain('resolveStats')
    expect(page).not.toContain('.slice(0, 3)')
    expect(page).toContain('eventsStat(s.events),')
    expect(read('app/admin/content/page.tsx')).toContain('The About and Why Smileys pages always show measured numbers.')
  })
  it('3: no "the groups are balanced" (27 of 192 recent events)', () => {
    expect(page).not.toContain('the groups are balanced')
    expect(page).toContain('Our events are hosted, the venues are chosen with care, and it always feels natural to walk in alone.')
  })
  it('4: how it works includes confirming the email, and the clock starts after it', () => {
    expect(page).toContain('Then confirm your email with the link we send you.')
    expect(page).toContain('within 24–48 hours of confirming your email.')
  })
  it('5: dark text on the amber bands; buttons untouched', () => {
    expect(page).not.toMatch(/text-amber-100|text-white mb-4/)
    expect(page).toContain('text-center text-amber-950">')
    expect(page).toContain('<Link href="/apply" className="btn-white">')
    expect(page).toContain('<Link href="/contact" className="btn-outline-white">')
  })
  it('7: no "here" on a page with no city', () => {
    expect(page).not.toContain('people born here')
    expect(page).not.toContain('found their people here')
  })
  it('8: the closing emoji is hidden from screen readers', () => {
    expect(page).toContain('<span aria-hidden="true">😊 </span>Ready to find your people?')
  })
  it('9: the country count is measured', () => {
    expect(page).toContain("SELECT count(DISTINCT lower(trim(nationality)))::int AS n FROM users WHERE status = 'approved'")
    expect(page).toContain("countries >= 100 ? 'more than 100 nationalities'")
  })
  it('10: AboutPage structured data', () => {
    expect(page).toContain("'@type':     'AboutPage',")
    expect(page).toContain('dangerouslySetInnerHTML={{ __html: jsonLdHtml(aboutJsonLd) }}')
  })
})
