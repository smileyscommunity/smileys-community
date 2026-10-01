'use client'

import Link from 'next/link'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import type { TripRow } from '@/lib/tripReport'

// Cross-city trips (lib/eventTrip): one row per trip, and whether it did what a
// trip is for — locals meeting the visitors, visitors joining the city.
// Numbers come from lib/tripReport; nothing is stored for this page.

const COLUMNS: { key: keyof TripRow; label: string; title: string }[] = [
  { key: 'going',   label: 'Going',   title: 'Approved places taken' },
  { key: 'went',    label: 'Went',    title: 'Checked in or marked attended' },
  { key: 'locals',  label: 'Locals',  title: 'Attendees who already belonged to the destination before the trip' },
  { key: 'alerted', label: 'Alerted', title: 'Destination members sent the "coming to <city>" alert' },
  { key: 'invited', label: 'Invited', title: 'Travellers sent the "add <city> to your cities" invite' },
  { key: 'joined',  label: 'Joined',  title: 'Travellers who added the destination on or after the trip day' },
]

export default function AdminTripsPage() {
  const { data, loading, error, retry } = useAdminLoad<{ trips: TripRow[] }>(
    '/app/api/admin/trips',
    (v): v is { trips: TripRow[] } => !!v && Array.isArray((v as { trips?: unknown }).trips),
  )
  const trips = data?.trips ?? []

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-white text-2xl font-extrabold">Trips</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Cross-city trips and what they did for the city they visited: locals who came, and travellers who joined it afterwards.
        </p>
      </div>

      <LoadErrorBanner message={error} onRetry={() => retry()} title="Couldn't load trips" />

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : trips.length === 0 ? (
        <p className="text-sm text-zinc-500">No trips yet. Create one from Events → New: pick a city club, then “Trip to another city”.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Trip</th>
                {COLUMNS.map(c => (
                  <th key={c.key} title={c.title} className="text-right px-3 py-3 font-semibold whitespace-nowrap">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {trips.map(t => (
                <tr key={t.id} className="text-zinc-200">
                  <td className="px-4 py-3 min-w-[16rem]">
                    <Link href={`/admin/events/${t.id}/edit`} className="font-semibold text-white hover:text-amber-400">{t.title}</Link>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {t.date} · 🚆 {t.origin} → {t.destination}{t.club ? ` · ${t.club}` : ''}{t.status !== 'published' ? ` · ${t.status}` : ''}
                    </p>
                  </td>
                  {COLUMNS.map(c => (
                    <td key={c.key} className="px-3 py-3 text-right tabular-nums">{t[c.key] as number}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-zinc-600">Hover a column heading for what it counts. Invites go out a day after a trip ends, with its survey.</p>
    </div>
  )
}
