'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { track } from '@/lib/analytics'

// Core Web Vitals from real visitors (LCP, INP, CLS, FCP, TTFB) as one
// `web_vital` event each, so the pages that matter can be compared by metric and
// device instead of guessed at. Same consent rule as every capture: nothing is
// sent until the cookie banner is accepted, so this samples consenting visitors
// only — good for trends, not a census. The path has no query string and no id
// segment values beyond what the URL already is; `device` is a coarse width
// bucket, not a fingerprint.
function bucket(): 'mobile' | 'tablet' | 'desktop' {
  const w = window.innerWidth
  return w < 768 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop'
}

export default function WebVitalsReporter() {
  useReportWebVitals(m => {
    track('web_vital', {
      metric: m.name,
      // CLS is a unitless score (keep three places); the rest are milliseconds.
      value: m.name === 'CLS' ? Math.round(m.value * 1000) / 1000 : Math.round(m.value),
      rating: m.rating,
      navigation_type: m.navigationType,
      path: window.location.pathname.replace(/^\/app/, '') || '/',
      device: bucket(),
    })
  })
  return null
}
