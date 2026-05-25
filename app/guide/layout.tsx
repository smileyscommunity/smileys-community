import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Istanbul City Guide — Smileys Community',
  description: 'Practical, admin-curated guide for expats in Istanbul. Transit tips, essential apps, neighbourhood guides, and local know-how.',
  openGraph: {
    title: 'Istanbul City Guide — Smileys Community',
    description: 'Ferries, metro lines, neighbourhoods, apps and practical tips — everything you need to navigate Istanbul as an expat.',
    url: 'https://smileyscommunity.com/guide',
  },
}

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
