import Link from 'next/link'
import Image from 'next/image'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveImageUrl } from '@/lib/data'

// Read-only permalink for a single hangout. Designed so stale push
// notifications (cancellation, recap from days ago, third-party links)
// don't 404 — instead the user sees what the hangout was, what happened
// to it, and a way back to the live feed.
//
// Why server-rendered (no 'use client'): this page does no mutations.
// All actions (join, cancel, message) happen on the main /hangouts feed
// where the join/leave/message UI already lives. Duplicating that here
// would create two sources of truth.

export const dynamic = 'force-dynamic'  // session-gated; no caching

interface PageProps {
  params: Promise<{ id: string }>
}

function StatusBanner({ status, endsAt }: { status: string; endsAt: Date }) {
  if (status === 'cancelled') {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-900">❌ This hangout was cancelled</p>
        <p className="text-xs text-red-700 mt-0.5">The host or a moderator called it off. Check the feed for other plans.</p>
      </div>
    )
  }
  if (status === 'expired' || endsAt < new Date()) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-bold text-gray-900">✓ This hangout has ended</p>
        <p className="text-xs text-gray-600 mt-0.5">
          Was a joiner? Leave a quick reference on the{' '}
          <Link href="/hangouts/recap" className="font-semibold text-amber-700 underline">recap page</Link>.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between gap-3">
      <p className="text-sm font-bold text-amber-900">This hangout is still open</p>
      <Link href="/hangouts" className="text-xs font-bold text-amber-700 bg-white border border-amber-300 hover:bg-amber-100 px-3 py-1.5 rounded-lg shrink-0">
        Open in feed →
      </Link>
    </div>
  )
}

export default async function HangoutPermalinkPage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login?next=/hangouts')

  const { id } = await params

  const hangout = await prisma.hangout.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, color: true, profilePhoto: true, goodHangouts: true, neighborhood: true } },
      joins: {
        orderBy: { createdAt: 'asc' },
        select: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      },
    },
  })

  if (!hangout) notFound()

  const hostAvatar = hangout.user.profilePhoto ? resolveImageUrl(hangout.user.profilePhoto) : null
  const photoUrl   = hangout.photo ? resolveImageUrl(hangout.photo) : null

  return (
    <div className="min-h-screen bg-warm pb-16">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-6 pb-6 space-y-4">
        <Link href="/hangouts" className="text-xs font-semibold text-amber-700 inline-flex items-center gap-1">
          ← Back to hangouts
        </Link>

        <StatusBanner status={hangout.status} endsAt={hangout.endsAt} />

        {/* Hero card */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          {/* Host header — shown first so you immediately know who's hosting */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-4">
            <Link href={`/members/${hangout.user.id}`} className="shrink-0">
              {hostAvatar
                ? <img src={hostAvatar} alt={hangout.user.name} className="w-12 h-12 rounded-full object-cover" />
                : <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold"
                    style={{ backgroundColor: hangout.user.color }}>{hangout.user.name[0]}</div>}
            </Link>
            <div className="flex-1 min-w-0">
              <Link href={`/members/${hangout.user.id}`} className="text-sm font-bold text-gray-900 hover:text-amber-700">
                {hangout.user.name}
              </Link>
              <p className="text-xs text-gray-500">
                is hosting a hangout{hangout.user.neighborhood && <> · 📍 {hangout.user.neighborhood}</>}
              </p>
            </div>
            {hangout.user.goodHangouts > 0 && (
              <span className="inline-flex items-center gap-0.5 px-2 py-1 rounded-full bg-green-50 text-green-700 text-xs font-semibold border border-green-200 shrink-0">
                ✓ {hangout.user.goodHangouts} good
              </span>
            )}
          </div>

          {photoUrl && (
            <div className="relative w-full h-48 sm:h-64 bg-gray-100">
              <Image src={photoUrl} alt={hangout.title} fill className="object-cover" sizes="(max-width: 640px) 100vw, 640px" unoptimized />
            </div>
          )}
          <div className="p-5 space-y-3">
            <div className="flex items-start gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold text-gray-900 flex-1 min-w-0">{hangout.title}</h1>
              {hangout.meetMode === 'solo' && (
                <span className="inline-flex items-center gap-0.5 px-2 py-1 rounded-full bg-purple-50 text-purple-700 text-xs font-semibold border border-purple-200 shrink-0">
                  1-on-1
                </span>
              )}
            </div>

            <div className="text-sm text-gray-700 space-y-1">
              <p>📍 <span className="font-medium">{hangout.location}</span>
                {hangout.neighborhood && <span className="text-gray-600"> · {hangout.neighborhood}</span>}
              </p>
              <p>🕒 <span className="font-medium">
                {hangout.startsAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {' – '}
                {hangout.endsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span></p>
            </div>

            {hangout.description && (
              <p className="text-sm text-gray-600 whitespace-pre-wrap pt-2 border-t border-gray-100">{hangout.description}</p>
            )}
          </div>
        </div>

        {/* Joiners */}
        {hangout.joins.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">
              {hangout.joins.length} joiner{hangout.joins.length === 1 ? '' : 's'}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {hangout.joins.map((j: any) => {
                const av = j.user.profilePhoto ? resolveImageUrl(j.user.profilePhoto) : null
                return (
                  <Link key={j.user.id} href={`/members/${j.user.id}`} className="flex items-center gap-2 text-xs">
                    {av
                      ? <img src={av} alt={j.user.name} className="w-7 h-7 rounded-full object-cover" />
                      : <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                          style={{ backgroundColor: j.user.color }}>{j.user.name[0]}</div>}
                    <span className="font-medium text-gray-700">{j.user.name}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Messages — read-only thread, replicates the in-feed chat. Only
            renders if there were any so empty hangouts don't show a blank
            section. */}
        {hangout.messages.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3">Chat</p>
            <div className="space-y-3">
              {hangout.messages.map((m: any) => {
                const av = m.user.profilePhoto ? resolveImageUrl(m.user.profilePhoto) : null
                return (
                  <div key={m.id} className="flex items-start gap-2.5">
                    {av
                      ? <img src={av} alt={m.user.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                      : <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                          style={{ backgroundColor: m.user.color }}>{m.user.name[0]}</div>}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs">
                        <span className="font-semibold text-gray-900">{m.user.name}</span>
                        <span className="text-gray-400"> · {m.createdAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                      </p>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">{m.body}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
