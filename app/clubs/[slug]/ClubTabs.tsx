'use client'

import { useState } from 'react'
import EventCard from '@/components/EventCard'
import ClubWall from '@/components/ClubWall'
import ClubAnnouncements from '@/components/ClubAnnouncements'
import ClubPhotos from '@/components/ClubPhotos'
import ClubMembers from '@/components/ClubMembers'
import { resolveImageUrl, getInitials } from '@/lib/data'

interface ClubEvent {
  id: string
  [key: string]: unknown
}

interface MemberAttendee {
  id: string; name: string; color: string; photo: string | null
}

interface Props {
  slug: string
  clubEvents: ClubEvent[]
  canPost: boolean
  currentUserId?: string
  isAdmin?: boolean
  canPin?: boolean
  canAnnounce: boolean
  canUpload: boolean
  memberAttendeesByEvent: Record<string, MemberAttendee[]>
}

function AttendeeStack({ attendees }: { attendees: MemberAttendee[] }) {
  if (!attendees.length) return null
  return (
    <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-amber-50 rounded-xl">
      <div className="flex -space-x-2">
        {attendees.slice(0, 5).map(a => {
          const photo = resolveImageUrl(a.photo)
          return photo ? (
            <img key={a.id} src={photo} alt={a.name} loading="lazy" className="w-7 h-7 rounded-full object-cover border-2 border-white" />
          ) : (
            <div key={a.id} className="w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: a.color }}>
              {getInitials(a.name)}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-amber-700 font-medium">
        {attendees.length === 1
          ? `${attendees[0].name} is going`
          : `${attendees[0].name} and ${attendees.length - 1} other${attendees.length > 2 ? 's' : ''} from this club`}
      </p>
    </div>
  )
}

type Tab = 'events' | 'wall' | 'announcements' | 'photos' | 'members'

export default function ClubTabs({
  slug, clubEvents, canPost, currentUserId, isAdmin, canPin,
  canAnnounce, canUpload, memberAttendeesByEvent,
}: Props) {
  const [tab, setTab] = useState<Tab>('events')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'events',        label: `Upcoming Events${clubEvents.length > 0 ? ` (${clubEvents.length})` : ''}` },
    { key: 'wall',          label: 'Wall' },
    { key: 'announcements', label: 'Announcements' },
    { key: 'photos',        label: 'Photos' },
    { key: 'members',       label: 'Members' },
  ]

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pb-3 px-1 mr-4 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'events' ? (
        clubEvents.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {clubEvents.map(event => (
              <div key={event.id}>
                <EventCard event={event as any} linkPrefix="/events" />
                {memberAttendeesByEvent[event.id]?.length > 0 && (
                  <AttendeeStack attendees={memberAttendeesByEvent[event.id]} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-card p-12 text-center">
            <span className="text-4xl block mb-3">📅</span>
            <p className="text-gray-500">No events scheduled yet. Check back soon!</p>
          </div>
        )
      ) : tab === 'wall' ? (
        <ClubWall
          slug={slug}
          canPost={canPost}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canPin={canPin}
        />
      ) : tab === 'announcements' ? (
        <ClubAnnouncements
          slug={slug}
          canAnnounce={canAnnounce}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
        />
      ) : tab === 'photos' ? (
        <ClubPhotos
          slug={slug}
          canUpload={canUpload}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canPin={canPin}
        />
      ) : (
        <ClubMembers slug={slug} />
      )}
    </div>
  )
}
