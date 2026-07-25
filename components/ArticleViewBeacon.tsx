'use client'

import { useEffect } from 'react'

// Fire-once-per-session view beacon for an article. Rendered on the handbook
// and community article pages. Client-side (JS-gated) so it naturally skips
// the vast majority of crawlers/bots, and sessionStorage-deduped so a refresh
// or a back-then-forward within the same tab session doesn't inflate the count.
// keepalive lets the POST complete even if the reader navigates away instantly.
export default function ArticleViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      const key = `viewed:${slug}`
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
      fetch(`/app/api/posts/${encodeURIComponent(slug)}/view`, {
        method: 'POST', credentials: 'include', keepalive: true,
      }).catch(() => {})
    } catch { /* sessionStorage blocked (private mode) — skip counting */ }
  }, [slug])

  return null
}
