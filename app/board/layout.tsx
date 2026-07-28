import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_URL } from '@/lib/env'

// The /board index page is a client component and can't export metadata, so
// its title/description/canonical live here. Canonical is safe: board/[id]
// sets its own, which overrides this for detail pages.
export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/board` },
  title: 'Community Board — Smileys Community',
  description: 'Rooms, jobs, services, buy & sell and more — the Smileys community board for Istanbul.',
}

export default function ListingsLayout({ children }: { children: ReactNode }) {
  return children
}
