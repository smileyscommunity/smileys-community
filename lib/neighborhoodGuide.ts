// ── Long-form neighborhood guide content ──
// data/neighborhoods/<slug>.json started as tagline + places + tips, and the
// "About" block on every page was a template sentence built from the
// registry row. That was fine for coverage and too thin to rank: Yeşilköy
// sat at #11 for its own name with one generic paragraph. These optional
// fields let a guide file carry real depth: hand-written About paragraphs,
// story sections (history, getting there, a half-day plan…) and an FAQ that
// also feeds FAQPage structured data.
//
// Every field is optional and validated here, because the files are
// hand-edited: a malformed entry is dropped, never rendered as "undefined"
// and never allowed to take the page down. A guide without any of these
// fields renders exactly as before.

export interface GuideStoryItem { title: string; body: string }

export interface GuideStorySection {
  heading: string
  /** Paragraphs shown under the heading. */
  body:    string[]
  /** Titled entries (e.g. history beats). */
  items:   GuideStoryItem[]
  /** An ordered plan (e.g. "a half-day in X"). */
  steps:   string[]
}

export interface GuideFaq { q: string; a: string }

export interface GuideLongForm {
  about:          string[]
  sections:       GuideStorySection[]
  faq:            GuideFaq[]
  seoDescription: string | null
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

function texts(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isText).map(s => s.trim()) : []
}

export function parseGuideLongForm(guide: unknown): GuideLongForm {
  const g = (guide && typeof guide === 'object' ? guide : {}) as Record<string, unknown>

  const sections: GuideStorySection[] = Array.isArray(g.sections)
    ? g.sections.flatMap((raw): GuideStorySection[] => {
        if (!raw || typeof raw !== 'object') return []
        const s = raw as Record<string, unknown>
        if (!isText(s.heading)) return []
        const items = Array.isArray(s.items)
          ? s.items.flatMap((it): GuideStoryItem[] => {
              const i = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>
              return isText(i.title) && isText(i.body) ? [{ title: i.title.trim(), body: i.body.trim() }] : []
            })
          : []
        const section = { heading: s.heading.trim(), body: texts(s.body), items, steps: texts(s.steps) }
        // A heading with nothing under it is an empty box on the page.
        return section.body.length || section.items.length || section.steps.length ? [section] : []
      })
    : []

  const faq: GuideFaq[] = Array.isArray(g.faq)
    ? g.faq.flatMap((raw): GuideFaq[] => {
        const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
        return isText(f.q) && isText(f.a) ? [{ q: f.q.trim(), a: f.a.trim() }] : []
      })
    : []

  return {
    about:          texts(g.about),
    sections,
    faq,
    seoDescription: isText(g.seoDescription) ? g.seoDescription.trim() : null,
  }
}

/** FAQPage JSON-LD for a guide's FAQ, or null when it has none. */
export function guideFaqJsonLd(faq: GuideFaq[]): Record<string, unknown> | null {
  if (faq.length === 0) return null
  return {
    '@context':  'https://schema.org',
    '@type':     'FAQPage',
    mainEntity:  faq.map(f => ({
      '@type':        'Question',
      name:           f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
}
