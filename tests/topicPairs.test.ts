import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { TOPIC_PAIRS, guideForOverview, overviewForGuide } from '@/lib/topicPairs'

describe('topic pairs', () => {
  it('look up both ways and never repeat a slug', () => {
    const all = TOPIC_PAIRS.flatMap(p => [p.overview, p.guide])
    expect(new Set(all).size).toBe(all.length)
    for (const p of TOPIC_PAIRS) {
      expect(guideForOverview(p.overview)).toBe(p.guide)
      expect(overviewForGuide(p.guide)).toBe(p.overview)
    }
    expect(guideForOverview('nope')).toBeNull()
  })
  it('both pages render the companion card, outside previews', () => {
    expect(readFileSync('app/posts/[slug]/page.tsx', 'utf8')).toContain('<TopicCompanion')
    expect(readFileSync('app/handbook/[slug]/page.tsx', 'utf8')).toContain('<TopicCompanion')
  })
})
