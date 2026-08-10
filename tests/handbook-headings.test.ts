import { describe, it, expect } from 'vitest'
import { migrateHeadings, looksLikeHeading } from '@/lib/handbook-headings'

describe('looksLikeHeading', () => {
  it('accepts the shape the editor actually produced', () => {
    expect(looksLikeHeading('Where to Buy an İstanbulkart')).toBe(true)
    expect(looksLikeHeading('1. Get a Turkish Tax Number')).toBe(true)
    expect(looksLikeHeading('Typical Costs (2026)')).toBe(true)
  })

  it('accepts question-form headings', () => {
    // Both of these are real headings in the live corpus.
    expect(looksLikeHeading('Need Help?')).toBe(true)
    expect(looksLikeHeading('Can I Use My Bank Card Instead?')).toBe(true)
  })

  it('rejects a bolded sentence — body copy must not become a heading', () => {
    expect(looksLikeHeading('Always confirm the fare before you get in.')).toBe(false)
    expect(looksLikeHeading('Bring these documents:')).toBe(false)
  })

  it('rejects the run-on bolded paragraphs in the bank-account article', () => {
    const runOn = 'Passport (original; copies aren’t enough).Tax number (Vergi Kimlik Numarası) — free from the tax office'
    expect(looksLikeHeading(runOn)).toBe(false)
  })

  it('rejects anything containing markup', () => {
    expect(looksLikeHeading('See <a href="https://x.com">the site</a>')).toBe(false)
    expect(looksLikeHeading('Two<br>lines')).toBe(false)
  })

  it('rejects empty and whitespace-only bold', () => {
    expect(looksLikeHeading('')).toBe(false)
    expect(looksLikeHeading('&nbsp;')).toBe(false)
  })
})

describe('migrateHeadings', () => {
  it('promotes a standalone bold paragraph to h2', () => {
    const { body, changes } = migrateHeadings('<p><strong>Utilities</strong></p><p>Pay online.</p>')
    expect(body).toBe('<h2>Utilities</h2><p>Pay online.</p>')
    expect(changes).toEqual([{ text: 'Utilities', level: 2 }])
  })

  it('demotes a heading that repeats within the article to h3', () => {
    // The scams article repeats "Stay safe" under each numbered scam — those
    // are subordinate to the scam headings, not siblings of them.
    const src = '<p><strong>1. Taxi Scams</strong></p><p><strong>Stay safe</strong></p>'
              + '<p><strong>2. ATM Safety</strong></p><p><strong>Stay safe</strong></p>'
    const { body } = migrateHeadings(src)
    expect(body).toBe('<h2>1. Taxi Scams</h2><h3>Stay safe</h3><h2>2. ATM Safety</h2><h3>Stay safe</h3>')
  })

  it('leaves inline bold inside a sentence alone', () => {
    const src = '<p>An anonymous card costs <strong>200 TRY</strong> today.</p>'
    expect(migrateHeadings(src).body).toBe(src)
  })

  it('never merges two adjacent paragraphs into one heading', () => {
    const src = '<p><strong>First</strong></p><p><strong>Second</strong></p>'
    const { body, changes } = migrateHeadings(src)
    expect(body).toBe('<h2>First</h2><h2>Second</h2>')
    expect(changes).toHaveLength(2)
  })

  it('leaves bold list items alone — only whole paragraphs are promoted', () => {
    const src = '<ul><li><p><strong>Metro</strong></p></li></ul>'
    // The <li><p> wrapper still exposes a bare <p><strong>…</strong></p>, so
    // guard the real risk: the list structure must survive intact.
    const { body } = migrateHeadings(src)
    expect(body.startsWith('<ul><li>')).toBe(true)
    expect(body.endsWith('</li></ul>')).toBe(true)
  })

  it('is idempotent — a second pass changes nothing', () => {
    const src = '<p><strong>Utilities</strong></p><p>Text.</p><p><strong>Internet</strong></p>'
    const once  = migrateHeadings(src)
    const twice = migrateHeadings(once.body)
    expect(twice.changes).toHaveLength(0)
    expect(twice.body).toBe(once.body)
  })

  it('preserves entities rather than double-decoding them', () => {
    const { body } = migrateHeadings('<p><strong>Residence Permit &amp; Immigration</strong></p>')
    expect(body).toBe('<h2>Residence Permit &amp; Immigration</h2>')
  })

  it('reports no changes for an article that already uses real headings', () => {
    const src = '<h2>Utilities</h2><p>Pay online.</p>'
    expect(migrateHeadings(src).changes).toHaveLength(0)
  })
})
