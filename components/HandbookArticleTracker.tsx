'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics'

// Fires one PostHog view event per handbook article mount, so we can see which
// topics members (and search visitors) actually read. Renders nothing.
export default function HandbookArticleTracker({ slug, title, category }: { slug: string; title: string; category: string }) {
  useEffect(() => {
    track('handbook_article_viewed', { slug, title, category })
  }, [slug, title, category])
  return null
}
