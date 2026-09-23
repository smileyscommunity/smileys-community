import Link from 'next/link'
import { goodToKnowRows, type GoodToKnowFacts } from '@/lib/eventGoodToKnow'

// "Good to know" — the answers a solo newcomer looks for before committing to
// an event: will I be welcome, will I understand anyone, is my place certain,
// and what if I can't make it. Server-rendered, no hooks, so both the guest
// teaser and the member view of app/events/[id] can use it.
//
// Every row is backed by a column on the event, and a row whose column is
// empty is not rendered — there is no "Language: not specified" and no
// invented default. The one unconditional row is the cancellation etiquette,
// because that is a community rule (FAQ → "How do I cancel my RSVP?"), not a
// per-event fact.
//
// Price, date, neighbourhood, host and the going count already sit in the
// page's header rows; they are deliberately not repeated here.

export default function EventGoodToKnow({ event, className = '' }: { event: GoodToKnowFacts; className?: string }) {
  // A cancelled event has nothing to plan around.
  if (event.status === 'cancelled') return null
  const rows = goodToKnowRows(event)
  return (
    <section aria-labelledby="good-to-know" className={`rounded-2xl border border-gray-100 bg-white p-4 sm:p-5 ${className}`}>
      <h2 id="good-to-know" className="text-sm font-bold text-gray-900 mb-3">Good to know</h2>
      <dl className="space-y-2.5 text-sm">
        {rows.map(r => (
          <div key={r.key} className="flex gap-2.5">
            <span aria-hidden="true" className="text-base leading-5 shrink-0">{r.icon}</span>
            <div className="min-w-0">
              <dt className="font-semibold text-gray-900 inline">{r.label}: </dt>
              <dd className="text-gray-600 inline whitespace-pre-line break-words">{r.text}</dd>
            </div>
          </div>
        ))}
        <div className="flex gap-2.5">
          <span aria-hidden="true" className="text-base leading-5 shrink-0">📅</span>
          <div className="min-w-0">
            <dt className="font-semibold text-gray-900 inline">If plans change: </dt>
            <dd className="text-gray-600 inline">
              cancel on this page as early as you can, so someone on the waitlist gets your spot.{' '}
              <Link href="/faq#events" className="font-semibold text-amber-700 hover:underline">How RSVPs work</Link>
            </dd>
          </div>
        </div>
      </dl>
    </section>
  )
}
