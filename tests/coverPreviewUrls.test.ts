import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { previewUrl } from '@/lib/data'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('previewUrl', () => {
  it('asks the file route for a resized variant of our own uploads', () => {
    expect(previewUrl('/app/api/files/posts/a.jpg')).toBe('/app/api/files/posts/a.jpg?w=800')
    expect(previewUrl('/api/files/general/b.jpg', 1200)).toBe('/app/api/files/general/b.jpg?w=1200')
    expect(previewUrl('/uploads/events/c.jpg')).toBe('/app/api/files/events/c.jpg?w=800')
  })
  it('leaves external images, static assets, empty values and URLs that already have a query alone', () => {
    expect(previewUrl('https://images.unsplash.com/x.jpg')).toBe('https://images.unsplash.com/x.jpg')
    expect(previewUrl('/app/images/guide/ferry.jpg')).toBe('/app/images/guide/ferry.jpg')
    expect(previewUrl(null)).toBe('')
    expect(previewUrl('/app/api/files/posts/a.jpg?w=1200')).toBe('/app/api/files/posts/a.jpg?w=1200')
  })
  it('only asks for widths the file route actually serves', () => {
    const route = read('app/api/files/[...path]/route.ts')
    expect(route).toMatch(/PREVIEW: ReadonlySet<number> = new Set\(\[800, 1200\]\)/)
  })
})

describe('covers on content pages use the resized variant', () => {
  it('handbook index cards and rows', () => {
    const p = read('app/handbook/page.tsx')
    expect(p).toMatch(/src=\{previewUrl\(c\.cover\)\}/)
    expect(p).toMatch(/src=\{previewUrl\(photo\)\}/)
    expect(p).toMatch(/src=\{previewUrl\(cover\)\}/)
    expect(p).not.toMatch(/<img src=\{(c\.cover|photo|cover)\}/)
  })
  it('handbook article cover', () => {
    expect(read('app/handbook/[slug]/EditableArticle.tsx')).toMatch(/src=\{previewUrl\(props\.coverImage, 1200\)\}/)
  })
  it('stories index and story cover', () => {
    const list = read('app/posts/page.tsx')
    expect(list).toMatch(/src=\{previewUrl\(featuredCover, 1200\)\}/)
    expect(list).toMatch(/src=\{previewUrl\(cover\)\}/)
    expect(read('app/posts/[slug]/page.tsx')).toMatch(/src=\{previewUrl\(post\.coverImage, 1200\)\}/)
  })
})
