import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { breadcrumbJsonLd } from '@/lib/breadcrumbJsonLd'

describe('breadcrumbJsonLd', () => {
  it('numbers the trail from 1 and ends on the page', () => {
    const j = breadcrumbJsonLd([{ name: 'Smileys', url: 'https://x/app' }, { name: 'Stories', url: 'https://x/app/posts' }, { name: 'A', url: 'https://x/app/posts/a' }])
    expect(j['@type']).toBe('BreadcrumbList')
    expect(j.itemListElement.map(i => i.position)).toEqual([1, 2, 3])
    expect(j.itemListElement[2].item).toBe('https://x/app/posts/a')
  })
})

describe('public article pages carry a breadcrumb trail', () => {
  it.each(['app/posts/[slug]/page.tsx', 'app/handbook/[slug]/page.tsx', 'app/guide/[slug]/page.tsx'])('%s', f => {
    expect(readFileSync(f, 'utf8')).toContain('breadcrumbJsonLd(')
  })
})
