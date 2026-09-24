'use client'

import Link from 'next/link'
import posthog from 'posthog-js'
import type { CSSProperties, ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { clubHref } from '@/lib/clubLink'

// A link to a club for pages that don't read the session on the server (the
// Guide, /why) — reading it there would make a cached page per-request. The
// destination follows lib/clubLink: the club page for members and while
// sign-in is resolving, the application for a guest. `event` keeps the
// Guide's PostHog click tracking (what TrackedLink did for these links).
export default function ClubLink({ slug, citySlug, className, style, event, eventProps, children }: {
  slug:        string
  citySlug?:   string | null
  className?:  string
  style?:      CSSProperties
  event?:      string
  eventProps?: Record<string, string | number | null>
  children:    ReactNode
}) {
  const { isLoggedIn, isLoading } = useAuth()
  const href = clubHref(slug, isLoading ? 'unknown' : isLoggedIn ? 'member' : 'guest', citySlug)
  return (
    <Link href={href} className={className} style={style}
      onClick={event ? () => posthog.capture(event, eventProps) : undefined}>
      {children}
    </Link>
  )
}
