import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { APP_URL } from '@/lib/env'

// The /directory index page is a client component and can't export metadata, so
// its title/description/canonical live here. Canonical is safe: directory/[id]
// sets its own, which overrides this for detail pages.
export const metadata: Metadata = {
  alternates: { canonical: `${APP_URL}/directory` },
  title: 'Istanbul Directory — Smileys Community',
  description: 'Member-recommended businesses, services and places across Istanbul — cafés, doctors, gyms and more, vouched for by the Smileys community.',
}

export default function DirectoryLayout({ children }: { children: ReactNode }) {
  return children
}
