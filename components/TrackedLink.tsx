'use client'

import Link from 'next/link'
import posthog from 'posthog-js'
import type { ReactNode } from 'react'

// Link that captures a PostHog event on click — used for the Guide's
// cross-feature outcome metrics (guide_to_handbook, guide_to_directory,
// guide_to_club, guide_to_neighborhood, …), which the IA brief values
// over raw page views. Fire-and-forget: navigation never waits.
export default function TrackedLink({ href, event, eventProps, className, children }: {
  href: string
  event: string
  eventProps?: Record<string, string | number | null>
  className?: string
  children: ReactNode
}) {
  return (
    <Link href={href} className={className} onClick={() => posthog.capture(event, eventProps)}>
      {children}
    </Link>
  )
}
