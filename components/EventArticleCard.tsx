import Link from 'next/link'
import TicketLink from '@/components/TicketLink'
import { formatEventDay, ticketHost, type EventDetails } from '@/lib/postEventDetails'

// "At a glance" card for an event article, built only from the structured
// fields on the post. A row appears only when its fact was supplied; nothing
// is inferred or defaulted. Public facts only — see lib/postEventDetails.
export default function EventArticleCard({ d, slug, isMember }: { d: EventDetails; slug: string; isMember: boolean }) {
  const when = [d.eventDate ? formatEventDay(d.eventDate) : null, d.startTime ? `${d.startTime}${d.timeConfirmed ? '' : ' (time not yet confirmed)'}` : null].filter(Boolean).join(' · ')
  const where = [d.venue, d.district].filter(Boolean).join(', ')
  const lang = [d.language, d.subtitles].filter(Boolean).join(' · ')
  const rows: [string, string][] = []
  if (when)        rows.push(['When', when])
  if (where)       rows.push(['Where', where])
  if (lang)        rows.push(['Language', lang])
  if (d.transport) rows.push(['Getting there', d.transport])
  if (d.benefit)   rows.push(['Smileys benefit', d.benefit])
  const host = d.ticketUrl ? ticketHost(d.ticketUrl) : ''

  return (
    <aside aria-label="Event details" className="mb-10 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
      <h2 className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">Event details</h2>
      {rows.length > 0 && (
        <dl className="space-y-2.5 text-[15px]">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-x-3">
              <dt className="font-semibold text-gray-900">{k}</dt>
              <dd className="text-gray-700 min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.ticketUrl && (
        <TicketLink href={d.ticketUrl} slug={slug} host={host}
          className="mt-4 flex items-center justify-center gap-2 w-full sm:w-auto sm:inline-flex px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors">
          Official ticket page{host ? ` (${host})` : ''} ↗
        </TicketLink>
      )}
      <p className="mt-4 text-xs text-gray-500">
        Details come from the organizer and can change — check the official page before you go.
        {!isMember && <> Want to go with other Smileys members? <Link href="/apply" className="text-amber-700 font-medium underline">Apply to join</Link>.</>}
      </p>
    </aside>
  )
}
