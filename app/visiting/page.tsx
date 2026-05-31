export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Visiting Istanbul? Meet locals — Smileys Community',
  description: 'Tell Smileys members you\'re coming to Istanbul. Locals will reach out to grab coffee, share neighborhood tips, and welcome you in.',
  openGraph: {
    title: 'Visiting Istanbul? Meet locals — Smileys Community',
    description: 'Post your trip dates, see who else is in town, and connect with locals before you arrive.',
    url: 'https://smileyscommunity.com/visiting',
  },
}

function formatRange(startsOn: string, endsOn: string) {
  const s = new Date(startsOn + 'T00:00:00')
  const e = new Date(endsOn + 'T00:00:00')
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  const fmt = (d: Date, withMonth: boolean) => d.toLocaleDateString('en-GB', withMonth
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric' })
  return sameMonth
    ? `${fmt(s, false)}–${fmt(e, true)}`
    : `${fmt(s, true)} – ${fmt(e, true)}`
}

export default async function VisitingPage() {
  const session = await getSession()
  const today   = new Date().toISOString().split('T')[0]

  const announcements = await prisma.visitorAnnouncement.findMany({
    where: { status: 'active', endsOn: { gte: today } },
    orderBy: { startsOn: 'asc' },
    take: 100,
    include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
  })

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 flex items-center justify-center text-2xl shadow-sm shrink-0">
              👋
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-1">Newcomers & Visitors</p>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight leading-tight">
                Visiting Istanbul?
              </h1>
              <p className="text-base text-gray-500 leading-relaxed mt-2 max-w-xl">
                Tell us when you&apos;re coming. Locals will reach out for coffee, tips, and intros before you arrive.
              </p>
              <Link href="/visiting/new"
                className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors shadow-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Post your visit
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">

        {announcements.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">✈️</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">No upcoming visitors yet</h2>
            <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
              Be the first to post. Tell members when you&apos;re in town and they&apos;ll welcome you in.
            </p>
            <Link href="/visiting/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Post your visit
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {announcements.map(a => (
              <div key={a.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3 mb-3">
                  {a.user?.profilePhoto ? (
                    <img src={a.user.profilePhoto} alt={a.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                      style={{ backgroundColor: a.user?.color || '#f59e0b' }}>
                      {a.name[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {a.user ? (
                        <Link href={`/members/${a.user.id}`} className="text-sm font-bold text-gray-900 hover:text-amber-600 transition-colors">{a.name}</Link>
                      ) : (
                        <p className="text-sm font-bold text-gray-900">{a.name}</p>
                      )}
                      {a.fromCity && (
                        <span className="text-xs text-gray-500">from {a.fromCity}</span>
                      )}
                      {a.user && (
                        <Link href={`/members/${a.user.id}`} className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full hover:bg-amber-200 transition-colors">Member →</Link>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                      <span className="font-semibold text-amber-700">{formatRange(a.startsOn, a.endsOn)}</span>
                      {a.neighborhood && <span>· 📍 {a.neighborhood}</span>}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap mb-3">{a.intro}</p>

                {session ? (
                  (a.contact || a.email) && (
                    <div className="pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-0.5">
                      {a.contact && <p>📞 <span className="font-mono text-gray-700">{a.contact}</span></p>}
                      {a.email   && <p>✉️ <span className="font-mono text-gray-700">{a.email}</span></p>}
                    </div>
                  )
                ) : (
                  <div className="pt-3 border-t border-gray-100">
                    <Link href="/login?next=/visiting" className="text-xs font-semibold text-amber-600 hover:text-amber-700">
                      Sign in to see contact details →
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Visitor CTA at bottom */}
        {!session && (
          <div className="mt-10 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-6 text-center text-white shadow-lg">
            <div className="text-3xl mb-3">😊</div>
            <p className="text-lg font-extrabold mb-1">Joining Smileys?</p>
            <p className="text-sm text-amber-50 max-w-md mx-auto mb-4">
              Locals across Istanbul host events every week — meet members before you arrive.
            </p>
            <Link href="/apply" className="inline-block px-5 py-2.5 bg-white text-amber-600 font-bold rounded-xl hover:bg-amber-50 transition-colors text-sm">
              Apply to join →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
