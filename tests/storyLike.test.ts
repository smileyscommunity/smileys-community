import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('story article like', () => {
  it('the story page renders the like button above share, outside preview', () => {
    const page = src('app/posts/[slug]/page.tsx')
    expect(page).toContain("import ArticleLike from '@/components/ArticleLike'")
    expect(page.indexOf('<ArticleLike')).toBeGreaterThan(page.indexOf('{!preview && ('))
    expect(page.indexOf('<ArticleLike')).toBeLessThan(page.indexOf('<SocialShare'))
  })
  it('the like route accepts published handbook and community posts only', () => {
    const r = src('app/api/handbook/[slug]/like/route.ts')
    expect(r).toContain("(post.kind !== 'handbook' && post.kind !== 'community') || post.status !== 'published'")
  })
})
