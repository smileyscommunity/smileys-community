import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { formatDate, resolveImageUrl, avatarUrl, getInitials, firstNameOf} from '@/lib/data'
import RecapShareButton from '@/components/RecapShareButton'
import { APP_URL } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default async function EventRecapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) redirect(`/login`)

  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true, title: true, emoji: true, date: true, time: true,
      location: true, neighborhood: true, status: true,
      coverImage: true, coverImagePosition: true,
    },
  })
  if (!event) notFound()

  const today = new Date().toISOString().split('T')[0]
  if (event.date >= today) {
    redirect(`/events/${id}`)
  }

  const [attendees, photos] = await Promise.all([
    prisma.eventAttendee.findMany({
      where: { eventId: id, status: 'approved' },
      include: { user: { select: { id: true, name: true, color: true, profilePhoto: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.eventPhoto.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    }),
  ])

  const checkedIn    = attendees.filter(a => a.checkedIn)
  const checkinCount = checkedIn.length
  const totalCount   = attendees.length
  const shareUrl     = `${APP_URL}/events/${id}`

  return (
    <div className="min-h-screen bg-warm pb-16">
      {/* Header */}
      <div className="bg-white/90 backdrop-blur border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href={`/events/${id}`} className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-base font-bold text-gray-900 flex-1 truncate">Event Recap</h1>
          <RecapShareButton url={shareUrl} title={event.title} />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Cover / hero */}
        <div className="bg-white rounded-2xl shadow-card overflow-hidden">
          {event.coverImage ? (
            <div className="relative w-full h-48">
              <Image src={resolveImageUrl(event.coverImage)} alt={event.title} fill
                className="object-cover" sizes="(max-width: 672px) 100vw, 672px"
                style={{ objectPosition: `center ${event.coverImagePosition ?? 50}%` }} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4">
                <p className="text-white text-xl font-extrabold leading-tight">{event.emoji} {event.title}</p>
                <p className="text-white/80 text-sm mt-0.5">{formatDate(event.date)} · {event.neighborhood}</p>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-amber-100 to-orange-100 p-8 text-center">
              <div className="text-6xl mb-3">{event.emoji}</div>
              <p className="text-xl font-extrabold text-gray-900">{event.title}</p>
              <p className="text-sm text-gray-600 mt-1">{formatDate(event.date)} · {event.neighborhood}</p>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-3 divide-x divide-gray-100 p-4">
            <div className="text-center px-2">
              <p className="text-2xl font-extrabold text-gray-900">{totalCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">Attended</p>
            </div>
            <div className="text-center px-2">
              <p className="text-2xl font-extrabold text-amber-600">{checkinCount}</p>
              <p className="text-xs text-gray-400 mt-0.5">Checked in</p>
            </div>
            <div className="text-center px-2">
              <p className="text-2xl font-extrabold text-gray-900">{photos.length}</p>
              <p className="text-xs text-gray-400 mt-0.5">Photos</p>
            </div>
          </div>
        </div>

        {/* Photo grid */}
        {photos.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Photos</p>
            <div className="grid grid-cols-3 gap-1.5">
              {photos.map(photo => (
                <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100">
                  <Image src={resolveImageUrl(photo.url)} alt={photo.caption ?? event.title}
                    fill className="object-cover" sizes="(max-width: 672px) 33vw, 224px" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Attendees */}
        {attendees.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              {checkinCount > 0 ? `${checkinCount} checked in` : `${totalCount} members attended`}
            </p>
            <div className="flex flex-wrap gap-3">
              {(checkinCount > 0 ? checkedIn : attendees).map(a => {
                // #7 perf: 128-wide thumb for the recap attendee grid.
                const photo = avatarUrl(a.user.profilePhoto ?? null, 128)
                return (
                  <Link key={a.userId} href={`/members/${a.userId}`}
                    className="flex flex-col items-center gap-1 group">
                    {photo ? (
                      <img src={photo} alt={a.user.name} loading="lazy" decoding="async" className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow-sm group-hover:ring-amber-300 transition-all" />
                    ) : (
                      <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-white shadow-sm group-hover:ring-amber-300 transition-all"
                        style={{ backgroundColor: a.user.color }}>
                        {getInitials(a.user.name)}
                      </div>
                    )}
                    <span className="text-xs text-gray-600 text-center max-w-[56px] truncate">{firstNameOf(a.user.name)}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex justify-center pt-2">
          <Link href={`/events/${id}`}
            className="text-sm text-amber-600 font-semibold hover:underline">
            ← Back to event
          </Link>
        </div>
      </div>
    </div>
  )
}
