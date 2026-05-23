import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatDate, resolveImageUrl } from '@/lib/data'

interface Props {
  eventId: string
  vibes: string[]
  neighborhood: string
  date: string
}

export default async function SimilarEvents({ eventId, vibes, neighborhood, date }: Props) {
  const events = await prisma.event.findMany({
    where: {
      id:     { not: eventId },
      status: 'published',
      date:   { gte: date },
      OR: [
        { neighborhood },
        { vibes: vibes.length ? { hasSome: vibes } : undefined },
      ],
    },
    orderBy: { date: 'asc' },
    take: 3,
    select: {
      id: true, title: true, date: true, time: true,
      emoji: true, neighborhood: true, coverImage: true, price: true,
    },
  })

  if (!events.length) return null

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <h2 className="text-base font-bold text-gray-900 mb-4">You might also like</h2>
      <div className="space-y-3">
        {events.map(e => (
          <Link key={e.id} href={`/events/${e.id}`}
            className="flex items-center gap-3 group hover:opacity-80 transition-opacity">
            <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-gray-100">
              {e.coverImage
                ? <img src={resolveImageUrl(e.coverImage)} alt={e.title} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-2xl">{e.emoji}</div>
              }
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 transition-colors truncate">{e.title}</p>
              <p className="text-xs text-gray-400 mt-0.5">{formatDate(e.date)} · {e.neighborhood}</p>
              <p className="text-xs font-semibold text-amber-600 mt-0.5">{e.price === 0 ? 'Free' : `₺${e.price}`}</p>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  )
}
