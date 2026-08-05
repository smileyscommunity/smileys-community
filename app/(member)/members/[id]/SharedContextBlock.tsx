'use client'

import Link from 'next/link'
import posthog from 'posthog-js'
import { neighborhoodToSlug } from '@/lib/neighborhoods'
import type { ProfileSharedContext } from '@/lib/memberOpeners'

export { suggestedOpeners } from '@/lib/memberOpeners'
export type { ProfileSharedContext } from '@/lib/memberOpeners'

// §28 — "You and Maria". Answers "why might I talk to this person" with
// facts, never a compatibility score. Renders nothing when there is no
// genuine overlap: an empty box would be worse than no box.
export default function SharedContextBlock({ ctx, firstName }: { ctx: ProfileSharedContext | null; firstName: string }) {
  if (!ctx) return null
  const has = ctx.clubs.length > 0 || !!ctx.neighborhood || ctx.events.length > 0 || ctx.hangouts.length > 0 || ctx.interests.length > 0
  if (!has) return null

  return (
    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 mb-6">
      <h2 className="text-sm font-extrabold text-amber-800 uppercase tracking-widest mb-3">
        You and {firstName}
      </h2>
      <ul className="space-y-2">
        {ctx.clubs.map(c => (
          <li key={c.id} className="flex items-center gap-2 text-sm text-gray-800">
            <span aria-hidden="true">{c.emoji}</span>
            <span>Both in</span>
            <Link href={`/clubs/${c.slug}`}
              onClick={() => posthog.capture('club_opened_from_profile', { club: c.slug })}
              className="font-bold text-amber-700 hover:underline">{c.name}</Link>
          </li>
        ))}
        {ctx.neighborhood && (
          <li className="flex items-center gap-2 text-sm text-gray-800">
            <span aria-hidden="true">📍</span>
            <span>Both spend time around</span>
            <Link href={`/neighborhoods/${neighborhoodToSlug(ctx.neighborhood)}`}
              onClick={() => posthog.capture('neighborhood_opened_from_profile', { neighborhood: ctx.neighborhood })}
              className="font-bold text-amber-700 hover:underline">{ctx.neighborhood}</Link>
          </li>
        )}
        {ctx.events.map(e => (
          <li key={e.id} className="flex items-center gap-2 text-sm text-gray-800">
            <span aria-hidden="true">{e.emoji}</span>
            <span>Both going to</span>
            <Link href={`/events/${e.id}`}
              onClick={() => posthog.capture('event_opened_from_profile', { eventId: e.id })}
              className="font-bold text-amber-700 hover:underline">{e.title}</Link>
          </li>
        ))}
        {ctx.hangouts.map(h => (
          <li key={h.id} className="flex items-center gap-2 text-sm text-gray-800">
            <span aria-hidden="true">⚡</span>
            <span>Both joining</span>
            <Link href={`/hangouts/${h.id}`}
              onClick={() => posthog.capture('hangout_opened_from_profile', { hangoutId: h.id })}
              className="font-bold text-amber-700 hover:underline">{h.title}</Link>
          </li>
        ))}
        {ctx.interests.length > 0 && (
          <li className="flex items-start gap-2 text-sm text-gray-800">
            <span aria-hidden="true">✨</span>
            <span>Both into <span className="font-semibold">{ctx.interests.join(', ')}</span></span>
          </li>
        )}
      </ul>
    </div>
  )
}
