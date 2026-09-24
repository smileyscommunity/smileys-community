import { readFileSync } from 'fs'
import { join } from 'path'
import type { Category } from '@/components/QuickReference'

// Quick-reference links (apps, official sites, practical how-tos) —
// moved here from /guide in the information-architecture cleanup: the
// Handbook owns "how the city works", the Guide owns experiences. The
// content still lives in data/city-guide.json (server-authoritative,
// edited via /admin's guide editor). Food & Drink is skipped: its
// cultural content was rebuilt as Guide experiences.
export function loadQuickReference(): Category[] {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'city-guide.json'), 'utf8'))
    return (raw.categories ?? [])
      .filter((cat: { label?: string }) => cat.label !== 'Food & Drink')
      .map((cat: { icon: string; label: string; updatedAt?: string; resources?: unknown[] }) => ({
        icon:      cat.icon,
        label:     cat.label,
        updatedAt: cat.updatedAt,
        resources: ((cat.resources ?? []) as { title: string; description: string; href?: string; badge?: string; tip?: string }[]).map(r => ({
          title:       r.title,
          description: r.description,
          href:        r.href || undefined,
          badge:       r.badge || undefined,
          tip:         r.tip  || undefined,
        })),
      }))
  } catch {
    return []
  }
}

/** Whether there is a quick reference to link to at all. */
export function hasQuickReference(): boolean {
  return loadQuickReference().length > 0
}
