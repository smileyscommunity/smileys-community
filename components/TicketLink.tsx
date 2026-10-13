'use client'

import { track } from '@/lib/analytics'
import type { ReactNode } from 'react'

// Outbound link to an organizer's PUBLIC ticket page. The analytics payload
// carries the article slug and the ticket host only — never the full URL
// (path/query can hold campaign or discount tokens).
export default function TicketLink({ href, slug, host, label, className, children }: {
  href: string; slug: string; host: string; label?: string; className?: string; children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      aria-label={label}
      className={className}
      onClick={() => track('event_ticket_click', { article_slug: slug, ticket_host: host })}
    >
      {children}
    </a>
  )
}
