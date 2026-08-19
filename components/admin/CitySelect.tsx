'use client'

import { useEffect, useState } from 'react'

// City picker for admin create forms (clubs, partners, directory). Renders
// nothing until more than one city exists — a single-city platform has no
// choice to offer, and every form using this predates multi-city.
//
// value '' means "don't send a cityId": the server then resolves the
// creator's own context (view-city cookie → their city → default). That is
// the pre-multi-city behaviour, kept as the default on purpose — picking a
// city is the exception, landing at home is the rule. The client can't
// preselect the admin's actual city because AppUser doesn't carry cityId;
// labeling the default honestly beats guessing.
//
// Moderators see the full list but the server rejects cross-city creates
// (canActInCity) — hiding options client-side would only duplicate that
// rule somewhere it can drift.
interface CityOption { id: string; name: string; status: string }

export default function CitySelect({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (cityId: string) => void
  className?: string
}) {
  const [cities, setCities] = useState<CityOption[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/app/api/admin/cities', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((rows: CityOption[]) => { if (!cancelled && Array.isArray(rows)) setCities(rows) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (cities.length < 2) return null

  return (
    <div>
      <label className="block text-xs font-semibold text-zinc-400 mb-1.5">City</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={className}>
        <option value="">Your city (default)</option>
        {cities.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}{c.status !== 'live' ? ' (coming soon)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
