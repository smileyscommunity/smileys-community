import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Handbook scan 2026-09-27, items 1–5: an article's chrome follows the
// ARTICLE's city; category, stage and quick-reference pages carry a canonical
// and the city's share card; search's dead end stays in the city; a pasted
// http:// link is upgraded rather than silently stripped; a save conflict
// keeps the typed text and offers an explicit overwrite.

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/city', () => ({
  DEFAULT_CITY_SLUG: 'istanbul',
  getCityConfig: vi.fn(), resolveCityId: vi.fn(),
}))
vi.mock('@/lib/cities', () => ({ getPublicCity: vi.fn() }))
vi.mock('@/lib/session', () => ({ getSession: vi.fn() }))

import { cityQs } from '@/lib/cityPageParam'
import { normalizeLinkHref } from '@/lib/editorLinks'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('cityQs', () => {
  it('is empty for the default city and ?city= for every other', () => {
    expect(cityQs('istanbul')).toBe('')
    expect(cityQs('izmir')).toBe('?city=izmir')
  })
})

describe('article page follows the article city (item 1)', () => {
  const src = read('app/handbook/[slug]/page.tsx')
  it('breadcrumb, category crumb and back link carry the city', () => {
    expect(src).toContain('const linkCity = post.cityId ? articleCity : viewerCity')
    expect(src).toContain('const qs       = cityQs(linkCity.slug)')
    expect(src).toContain('href={`/handbook${qs}`} className="hover:text-amber-600 font-semibold">📖 Handbook')
    expect(src).toContain('href={`/handbook/category/${encodeURIComponent(catKey)}${qs}`}')
    expect(src).toContain('href={`/handbook${qs}`} className="text-sm text-amber-600 font-bold hover:underline">← Back to the Handbook')
    expect(src).not.toContain('href="/handbook"')
  })
  it('related articles and the quick-links callout are scoped to the article city', () => {
    expect(src).toContain('post.cityId ?? cityId,\n    linkCity.country ?? null,')
    expect(src).toContain('const linkCityIsDefault = linkCity.slug === DEFAULT_CITY_SLUG')
    expect(src).toContain('{linkCityIsDefault && HANDBOOK_TO_GUIDE[catKey] && (')
    expect(src).not.toContain('viewerCityIsDefault')
  })
  it('the not-found page sends the reader back to their own city', () => {
    const nf = read('app/handbook/not-found.tsx')
    expect(nf).toContain('href={`/handbook${cityQs(city.slug)}`}')
    expect(nf).not.toContain('href="/handbook"')
  })
})

describe('secondary pages carry a canonical and the share card (item 2)', () => {
  it('the category page: canonical on the canonical key, openGraph, pinned redirect, city back link', () => {
    const src = read('app/handbook/category/[key]/page.tsx')
    expect(src).toContain('alternates:  { canonical: url }')
    expect(src).toContain('`${APP_URL}/handbook/category/${encodeURIComponent(canonicalKey)}${cityQs(city.slug)}`')
    expect(src).toContain("shareCover('handbook', city,")
    expect(src).toContain('if (!pinned && cfg.slug !== DEFAULT_CITY_SLUG) redirect(`/handbook/category/${encodeURIComponent(canonical)}?city=${cfg.slug}`)')
    expect(src).toContain('href={`/handbook${qs}`}')
    expect(src).not.toContain('href="/handbook"')
  })
  it('the stage and quick-reference pages share the city cover, not the brand card', () => {
    for (const p of ['app/handbook/stage/[key]/page.tsx', 'app/handbook/quick-reference/page.tsx']) {
      const src = read(p)
      expect(src, p).toContain("shareCover('handbook', city,")
      expect(src, p).toContain('openGraph:   { title, description')
      expect(src, p).toContain('alternates:  { canonical: url }')
    }
  })
})

describe('search dead end stays in the city (item 3)', () => {
  it('the board link comes from the index, and an empty corpus does not promise suggestions', () => {
    expect(read('app/handbook/page.tsx')).toContain('boardHref={`/board${cityQs(cfg.slug)}`}')
    const src = read('components/HandbookSearch.tsx')
    expect(src).toContain('<Link href={boardHref}')
    expect(src).not.toContain('href="/board"')
    expect(src).toContain("suggestions.length > 0\n              ? 'Try one of the suggestions above")
  })
})

describe('editor links (item 4)', () => {
  it('upgrades http:// and bare hosts to https://, keeps mailto:, and both editor call sites use it', () => {
    expect(normalizeLinkHref('http://e-devlet.gov.tr')).toBe('https://e-devlet.gov.tr')
    expect(normalizeLinkHref('HTTP://x.y/z?q=1')).toBe('https://x.y/z?q=1')
    expect(normalizeLinkHref('https://already.ok')).toBe('https://already.ok')
    expect(normalizeLinkHref('  gov.tr/path ')).toBe('https://gov.tr/path')
    expect(normalizeLinkHref('mailto:hi@smileys.example')).toBe('mailto:hi@smileys.example')
    expect(normalizeLinkHref('   ')).toBe('')
    const src = read('components/RichTextEditor.tsx')
    expect(src.match(/setLink\(\{ href: normalizeLinkHref\(url\) \}\)/g)).toHaveLength(2)
    expect(src).not.toContain('/^https?:\\/\\//i.test(url)')
  })
})

describe('inline editor conflict (item 5)', () => {
  it('re-reads the version, keeps the text, and requires an explicit Save anyway', () => {
    const src = read('app/handbook/[slug]/EditableArticle.tsx')
    expect(src).toContain('if (res.status === 409) {')
    expect(src).toContain('if (fresh) setLoaded({ coverImage: fresh.coverImage ?? null, status: fresh.status, category: fresh.category, updatedAt: fresh.updatedAt })')
    expect(src).toContain('setConflict(true)')
    expect(src).toContain("conflict ? 'Save anyway' : 'Save changes'")
    expect(src).toContain('Open their version')
    expect(src).toContain('{ setEditing(false); setConflict(false) }')
    // The text is never reset on the conflict path.
    const conflictBlock = src.slice(src.indexOf('if (res.status === 409) {'), src.indexOf("toast.error(d.error ?? 'Save failed')"))
    expect(conflictBlock).not.toContain('setTitle(')
    expect(conflictBlock).not.toContain('setBody(')
    expect(read('app/handbook/[slug]/page.tsx')).toContain('slug={post.slug}')
  })
})
