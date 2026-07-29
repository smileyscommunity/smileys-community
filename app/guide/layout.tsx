import type { Metadata } from 'next'
import { APP_URL } from '@/lib/env'

export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/guide` },
  title: 'Istanbul City Guide — Smileys Community',
  description: 'Practical, admin-curated guide for expats in Istanbul. Transit tips, essential apps, neighborhood guides, and local know-how.',
  openGraph: {
    title: 'Istanbul City Guide — Smileys Community',
    description: 'Ferries, metro lines, neighborhoods, apps and practical tips — everything you need to navigate Istanbul as an expat.',
    url: `${APP_URL}/guide`,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Istanbul City Guide — Smileys Community',
    description: 'Ferries, metro lines, neighborhoods, apps and practical tips — everything you need to navigate Istanbul as an expat.',
  },
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
