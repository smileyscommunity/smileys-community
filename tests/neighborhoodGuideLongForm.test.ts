import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseGuideLongForm, guideFaqJsonLd } from '@/lib/neighborhoodGuide'

describe('parseGuideLongForm', () => {
  it('returns empty content for a guide without long-form fields', () => {
    expect(parseGuideLongForm({ tagline: 'x', places: [], tips: [] })).toEqual({
      about: [], sections: [], faq: [], seoDescription: null,
    })
    expect(parseGuideLongForm(null).sections).toEqual([])
  })

  it('drops malformed entries instead of rendering them', () => {
    const out = parseGuideLongForm({
      about: ['One.', '', 42, '  Two.  '],
      sections: [
        { heading: 'Empty' },
        { heading: '', body: ['no heading'] },
        { heading: 'Ok', items: [{ title: 'A', body: 'a' }, { title: 'B' }], steps: ['s1', null] },
      ],
      faq: [{ q: 'Q?', a: 'A.' }, { q: 'No answer' }],
      seoDescription: '   ',
    })
    expect(out.about).toEqual(['One.', 'Two.'])
    expect(out.sections).toEqual([{ heading: 'Ok', body: [], items: [{ title: 'A', body: 'a' }], steps: ['s1'] }])
    expect(out.faq).toEqual([{ q: 'Q?', a: 'A.' }])
    expect(out.seoDescription).toBeNull()
  })

  it('builds FAQPage JSON-LD only when there is an FAQ', () => {
    expect(guideFaqJsonLd([])).toBeNull()
    const ld = guideFaqJsonLd([{ q: 'Q?', a: 'A.' }]) as { '@type': string; mainEntity: unknown[] }
    expect(ld['@type']).toBe('FAQPage')
    expect(ld.mainEntity).toHaveLength(1)
  })
})

describe('Yeşilköy guide file', () => {
  const guide = JSON.parse(readFileSync(join(process.cwd(), 'data', 'neighborhoods', 'yesilkoy.json'), 'utf8'))
  const lf = parseGuideLongForm(guide)

  it('carries the long-form content and a description within the display budget', () => {
    expect(lf.about.length).toBeGreaterThan(0)
    expect(lf.sections.length).toBeGreaterThan(0)
    expect(lf.faq.length).toBeGreaterThan(0)
    expect(lf.seoDescription!.length).toBeLessThanOrEqual(160)
  })

  it('places Florya west of Yeşilköy, not north', () => {
    expect(JSON.stringify(guide)).not.toMatch(/Florya \(just north\)/)
  })
})
