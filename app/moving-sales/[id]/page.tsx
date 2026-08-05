import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import { APP_URL, SITE_URL } from '@/lib/env'
import MovingSaleContact from '@/components/MovingSaleContact'

export const dynamic = 'force-dynamic'

async function getSale(id: string) {
  return prisma.movingSale.findUnique({
    where: { id, status: 'active' },
    include: {
      user:  { select: { id: true, name: true, color: true, profilePhoto: true } },
      items: { select: { id: true, name: true, price: true, claimed: true }, orderBy: { claimed: 'asc' } },
    },
  })
}

function fmtLeaving(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const sale = await getSale(id)
  if (!sale) return {}

  const firstName = sale.user.name.split(' ')[0]
  const title = `${firstName}'s Moving Sale — Smileys Community`
  const itemsPart = sale.items.map(it => it.name).join(', ')
  const description = `Leaving ${fmtLeaving(sale.leavingOn)}${sale.neighborhood ? ` from ${sale.neighborhood}` : ''} — ${sale.note || itemsPart}`.slice(0, 160)
  const pageUrl = `${APP_URL}/moving-sales/${id}`

  const photo = sale.photo ? resolveImageUrl(sale.photo) : null
  const imageUrl = photo?.startsWith('http') ? photo : photo ? `${SITE_URL}${photo}?w=1200` : `${APP_URL}/api/og`

  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      title, description, url: pageUrl, siteName: 'Smileys Community',
      images: [{ url: imageUrl, width: 1200, height: 630, alt: title }],
      type: 'website',
    },
    twitter: {
      card: sale.photo ? 'summary_large_image' : 'summary',
      title, description, images: [imageUrl],
    },
  }
}

export default async function MovingSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [sale, session] = await Promise.all([getSale(id), getSession()])

  if (!sale) notFound()

  const photo  = sale.photo ? resolveImageUrl(sale.photo) : null
  const avatar = avatarUrl(sale.user.profilePhoto, 128)
  const isOwner = session?.id === sale.user.id
  const unclaimed = sale.items.filter(it => !it.claimed).length

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-0">

      <div className="bg-white/90 backdrop-blur border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/board?tab=MOVING" className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="font-semibold text-gray-900 text-sm truncate flex-1">Moving Sale</span>
          {isOwner && (
            <Link href="/board?tab=MOVING" className="text-xs text-amber-600 font-semibold hover:underline">
              Manage
            </Link>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

          {photo ? (
            <div className="bg-gray-100">
              <img src={photo} alt="" className="w-full max-h-[60vh] object-contain" />
            </div>
          ) : (
            <div className="relative h-40 bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center">
              <span className="text-7xl opacity-70 select-none">📦</span>
            </div>
          )}

          <div className="p-6 space-y-5">

            <div className="flex items-center gap-2 flex-wrap">
              {sale.neighborhood && (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                  📍 {sale.neighborhood}
                </span>
              )}
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">
                {sale.items.length} item{sale.items.length !== 1 ? 's' : ''}
                {unclaimed < sale.items.length && ` · ${unclaimed} left`}
              </span>
              <span className="text-xs text-gray-400 ml-auto">Leaving {fmtLeaving(sale.leavingOn)}</span>
            </div>

            <h1 className="text-2xl font-extrabold text-gray-900 leading-snug">
              {sale.user.name.split(' ')[0]}&apos;s Moving Sale
            </h1>

            {sale.note && <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{sale.note}</p>}

            <ul className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
              {sale.items.map(it => (
                <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white">
                  <span className={`text-sm ${it.claimed ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{it.name}</span>
                  <span className={`text-sm font-bold shrink-0 ${it.claimed ? 'text-gray-300' : it.price ? 'text-gray-900' : 'text-teal-600'}`}>
                    {it.claimed ? 'Claimed' : it.price ?? 'FREE'}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
              {avatar ? (
                <img src={avatar} alt={sale.user.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shrink-0 text-sm"
                  style={{ backgroundColor: sale.user.color || '#f59e0b' }}>
                  {sale.user.name[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm">{sale.user.name}</p>
                <p className="text-xs text-gray-400">Posting their moving sale</p>
              </div>
              {session && (
                <Link href={`/members/${sale.user.id}`}
                  className="text-xs text-amber-600 font-semibold hover:underline shrink-0">
                  View profile →
                </Link>
              )}
            </div>

            {session ? (
              !isOwner && <MovingSaleContact saleId={sale.id} firstName={sale.user.name.split(' ')[0]} />
            ) : (
              <div className="text-center space-y-3 py-4 bg-amber-50 rounded-2xl px-4">
                <p className="text-sm font-semibold text-gray-700">Members only</p>
                <p className="text-xs text-gray-600">Sign in to contact {sale.user.name.split(' ')[0]} and claim items.</p>
                <Link href={`/login?return=/moving-sales/${id}`}
                  className="inline-block px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
                  Sign in to Smileys →
                </Link>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
