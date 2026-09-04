'use client'

import { useEffect, useState } from 'react'

// City picker + badge for admin surfaces. Everything here renders nothing
// until more than one city exists — a single-city platform has no city
// dimension worth showing, and every page using these predates multi-city.
export interface CityOption { id: string; name: string; slug: string; status: string; country?: string; isDefault?: boolean }

// One fetch per mounted consumer; cities change about as often as a launch,
// so there is nothing to poll or cache-bust.
export function useAdminCities(): CityOption[] {
  const [cities, setCities] = useState<CityOption[]>([])
  useEffect(() => {
    let cancelled = false
    fetch('/app/api/admin/cities', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: CityOption[]) => { if (!cancelled && Array.isArray(rows)) setCities(rows) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return cities
}

// Compact per-row badge. Deliberately silent for the default city: with one
// young city and a thousand Istanbul rows, a badge on every row is noise —
// the job is to make the Bodrum row jump out, not to label Istanbul.
export function CityBadge({ city, cities }: { city?: { name: string; slug: string } | null; cities: CityOption[] }) {
  if (!city || cities.length < 2) return null
  const def = cities.find(c => c.isDefault)
  if (def && city.slug === def.slug) return null
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/15 text-sky-400 border border-sky-500/25">
      {city.name}
    </span>
  )
}

// Two jobs, two defaults for the empty option:
//  - create forms: '' = "don't send a cityId", the server resolves the
//    creator's own context. That is the pre-multi-city behaviour, kept as
//    the default on purpose — picking a city is the exception. The client
//    can't preselect the admin's actual city (AppUser doesn't carry cityId);
//    labeling the default honestly beats guessing.
//  - list filters: pass emptyLabel="All cities" (and label={null} for a bare
//    toolbar control), where '' = no filter.
//
// Moderators see the full list but the server rejects cross-city action
// (canActInCity) — hiding options client-side would only duplicate that
// rule somewhere it can drift.
export default function CitySelect({
  value,
  onChange,
  className,
  label = 'City',
  emptyLabel = 'Your city (default)',
}: {
  value: string
  onChange: (cityId: string) => void
  className?: string
  label?: string | null
  emptyLabel?: string
}) {
  const cities = useAdminCities()

  if (cities.length < 2) return null

  const select = (
    <select value={value} onChange={e => onChange(e.target.value)} className={className}>
      <option value="">{emptyLabel}</option>
      {cities.map(c => (
        <option key={c.id} value={c.id}>
          {c.name}{c.status !== 'live' ? ' (coming soon)' : ''}
        </option>
      ))}
    </select>
  )

  if (label === null) return select
  return (
    <div>
      <label className="block text-xs font-semibold text-zinc-400 mb-1.5">{label}</label>
      {select}
    </div>
  )
}
