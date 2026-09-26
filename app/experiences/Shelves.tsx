import Link from 'next/link'
import Image from 'next/image'
import { formatPrice, formatShortDate, resolveImageUrl, BLUR_PLACEHOLDER } from '@/lib/data'
import type { ExperiencesData, ShelfViewer } from './data'

// The shelves themselves — one grid per Experience tag — shared by the
// viewer's-city /experiences and the fixed-city /[city]/experiences hub.
// Markup only: what is on the shelves is decided in ./data and
// lib/experiences. `viewer` is the per-request layer: a member sees which of
// these they already hold a seat at.

export default function Shelves({ shelves, viewer }: { shelves: ExperiencesData['shelves']; viewer: ShelfViewer }) {
  return (
    <>
      {shelves.map(shelf => (
        <section key={shelf.name}>
          <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-4">
            <span aria-hidden="true">{shelf.emoji}</span> {shelf.name}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {shelf.cards.map(({ event: e, cadence, moreDates, moreCount, cancelledDates, cancelled, soldOut }) => {
              const going = viewer.going.has(e.id)
              return (
              <Link key={e.id} href={`/events/${e.id}`}
                className={`card overflow-hidden group hover:-translate-y-0.5 transition-transform${cancelled ? ' opacity-80' : ''}`}>
                <div className="relative aspect-[16/9] bg-gradient-to-br from-amber-100 to-amber-200">
                  {e.coverImage ? (
                    <Image
                      src={resolveImageUrl(e.coverImage)}
                      alt={e.title}
                      fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      placeholder="blur" blurDataURL={BLUR_PLACEHOLDER}
                      className="object-cover"
                      style={{ objectPosition: `50% ${e.coverImagePosition ?? 50}%` }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-5xl">{e.emoji}</div>
                  )}
                  {cadence && (
                    <span className="absolute top-3 left-3 bg-white/95 text-gray-900 text-[11px] font-bold px-2.5 py-1 rounded-full shadow-sm">
                      🔁 {cadence}
                    </span>
                  )}
                  {going && !cancelled && (
                    <span className="absolute top-3 right-3 bg-green-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow-sm">
                      ✓ You&apos;re going
                    </span>
                  )}
                  {/* Same stamps as EventCard: cancelled greys the cover out,
                      sold out only dims it — the detail page still offers
                      the waitlist. */}
                  {cancelled && (
                    <>
                      <div className="absolute inset-0 bg-red-950/45 backdrop-grayscale pointer-events-none" />
                      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
                        <span className="bg-red-600 text-white text-xs font-extrabold tracking-widest uppercase px-3 py-1 rounded-md shadow-lg -rotate-6">
                          Cancelled
                        </span>
                      </div>
                    </>
                  )}
                  {soldOut && !cancelled && !going && (
                    <>
                      <div className="absolute inset-0 bg-gray-950/35 pointer-events-none" />
                      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
                        <span className="bg-violet-600 text-white text-xs font-extrabold tracking-widest uppercase px-3 py-1 rounded-md shadow-lg -rotate-6">
                          Sold out
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <div className="p-4">
                  {/* No emoji prefix: legacy titles often carry their own
                      leading emoji (pre-splitLeadingEmoji rows), and the
                      cover fallback already renders e.emoji large. */}
                  <p className="font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">
                    {e.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-1.5">
                    {cadence ? `Next: ${formatShortDate(e.date)}` : formatShortDate(e.date)} · {e.time} · {e.neighborhood}
                  </p>
                  {moreDates.length > 0 && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Also {moreDates.map(formatShortDate).join(' · ')}{moreCount > moreDates.length ? ` · +${moreCount - moreDates.length} more` : ''}
                    </p>
                  )}
                  {cancelledDates.length > 0 && (
                    <p className="text-xs text-red-600 mt-0.5">
                      {cancelledDates.map(formatShortDate).join(' · ')} cancelled
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    {cancelled ? (
                      <span className="text-sm font-bold text-red-600">Cancelled</span>
                    ) : going ? (
                      <span className="text-sm font-bold text-green-700">You&apos;re going</span>
                    ) : soldOut ? (
                      <span className="text-sm font-bold text-violet-700">Sold out · waitlist</span>
                    ) : e.price === 0 ? (
                      <span className="text-sm font-bold text-gray-900">Free</span>
                    ) : e.memberPrice ? (
                      /* Same two-line price as EventCard: the member rate is
                         the one that matters to who this page is for; the
                         guest rate stays visible unless the door is
                         members-only. */
                      <span className="leading-tight">
                        <span className="text-xs text-violet-600 font-semibold">Members</span>{' '}
                        <span className="text-sm font-bold text-violet-700">{formatPrice(e.memberPrice, e.currency)}</span>
                        {!e.membersOnly && (
                          <span className="block text-[11px] text-gray-400">Guests {formatPrice(e.price, e.currency)}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-sm font-bold text-gray-900">{formatPrice(e.price, e.currency)}</span>
                    )}
                    {e.club && (
                      <span className="text-xs text-gray-500">
                        <span aria-hidden="true">{e.club.emoji}</span> {e.club.name}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}
