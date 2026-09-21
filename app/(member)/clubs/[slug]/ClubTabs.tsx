'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import EventCard from '@/components/EventCard'
import ClubConversations from '@/components/ClubConversations'
import ClubHangouts from '@/components/ClubHangouts'
import ClubAnnouncements from '@/components/ClubAnnouncements'
import ClubPhotos from '@/components/ClubPhotos'
import ClubMembers from '@/components/ClubMembers'
import ClubPastEvents from '@/components/ClubPastEvents'
import ClubReviews from '@/components/ClubReviews'
import { resolveImageUrl, getInitials } from '@/lib/data'
import type { Event } from '@/lib/data'
import { DEFAULT_TZ } from '@/lib/cityTime'

interface MemberAttendee {
  id: string; name: string; color: string; photo: string | null
}

interface Props {
  slug: string
  clubEvents: Event[]
  canPost: boolean
  currentUserId?: string
  isAdmin?: boolean
  canPin?: boolean
  canAnnounce: boolean
  canUpload: boolean
  isMember: boolean
  clubId: string
  // Private clubs keep their roster for members and staff; the tab goes too.
  isPrivate?: boolean
  memberAttendeesByEvent: Record<string, MemberAttendee[]>
  // cityId -> IANA zone for the cities these events are in. Without it the
  // cards judged "started"/"deadline" on Istanbul's clock, so a Tbilisi
  // event kept a working Join for an hour after the server refused it.
  cityTimeZones?: Record<string, string>
  // Counts surfaced as small badges on the tab labels — passed from
  // the server so the badge is rendered immediately on first paint
  // (no client-side flash from a follow-up fetch).
  memberCount: number
  reviewCount: number
  reviewAvg:   number | null
  // Every tab carries its own count now. Without these, a club with nothing
  // coming up gave no clue which of the other five had anything in it.
  pastEventCount:     number
  conversationCount:  number
  photoCount:         number
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

type Tab = 'events' | 'wall' | 'photos' | 'past' | 'reviews' | 'members'
const TAB_KEYS: readonly Tab[] = ['events', 'wall', 'photos', 'past', 'reviews', 'members']

export default function ClubTabs({
  slug, clubEvents, canPost, currentUserId, isAdmin, canPin,
  canAnnounce, canUpload, isMember, clubId, isPrivate = false, memberAttendeesByEvent,
  cityTimeZones = {}, memberCount, reviewCount, reviewAvg,
  pastEventCount, conversationCount, photoCount,
}: Props) {
  // Tab state lives in ?tab= rather than useState: the phone's Back
  // gesture then returns to the previous tab instead of leaving the club
  // entirely, and tabs become deep-linkable (e.g. /clubs/x?tab=wall from
  // a notification).
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const param = searchParams.get('tab')
  // A ?tab=members deep link on a private club must not mount the roster
  // for an outsider (the API refuses it, and the empty state read as "no
  // members yet").
  const membersAllowed = !isPrivate || isMember || isAdmin
  // Which tab to open when the URL doesn't say. It was always Events, and
  // 156 of the 166 active clubs have nothing coming up — so Turkish, with 114
  // members, 3 past events and 5 reviews, opened on "No events scheduled yet"
  // and read as a club that had never done anything. Land on the first tab
  // with something in it instead, in the order a newcomer would want it:
  // what's next, then what this club has actually done, then what people said
  // about it, then the room itself.
  //
  // Members is deliberately not in this chain. A roster is not something the
  // club did, the header already says "114 members", and the count now sits
  // on the tab — whereas the empty Events tab carries the "Start a
  // conversation" prompt, which is the one useful thing to offer a club that
  // has genuinely never done anything. Including it sent 118 of 166 clubs to
  // a list of faces and hid that prompt.
  const firstWithSomething: Tab =
    clubEvents.length     > 0 ? 'events'
    : pastEventCount      > 0 ? 'past'
    : reviewCount         > 0 ? 'reviews'
    : conversationCount   > 0 ? 'wall'
    : photoCount          > 0 ? 'photos'
    : 'events'
  const tab: Tab = TAB_KEYS.includes(param as Tab) && (param !== 'members' || membersAllowed) ? (param as Tab) : firstWithSomething
  // The default tab keeps the bare URL, whichever one it is, so a share link
  // is clean and Back still leaves the club rather than cycling tabs.
  const setTab = (next: Tab) => {
    router.push(next === firstWithSomething ? pathname : `${pathname}?tab=${next}`, { scroll: false })
  }

  // Compose the Reviews label with both the count and the average:
  // "Reviews (12) · ★ 4.7". Falls back to a plain "Reviews" label
  // when the club has none yet — no point teasing an empty rating.
  const reviewsLabel = reviewCount > 0
    ? `Reviews (${reviewCount})${reviewAvg != null ? ` · ★ ${reviewAvg.toFixed(1)}` : ''}`
    : 'Reviews'

  // A count on every tab, or on none: a bare "Photos" beside "Past Events (3)"
  // reads as "Photos has some too". Zero stays bare rather than showing (0),
  // which would be four ways of saying nothing is here.
  const withCount = (label: string, n: number) => n > 0 ? `${label} (${n})` : label
  const tabs: { key: Tab; label: string }[] = ([
    { key: 'events',  label: withCount('Events', clubEvents.length) },
    { key: 'wall',    label: withCount('Conversations', conversationCount) },
    { key: 'members', label: withCount('Members', memberCount) },
    { key: 'photos',  label: withCount('Photos', photoCount) },
    { key: 'reviews', label: reviewsLabel },
    { key: 'past',    label: withCount('Past Events', pastEventCount) },
  ] as { key: Tab; label: string }[]).filter(t => t.key !== 'members' || !isPrivate || isMember || isAdmin)

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pb-3 px-1 mr-4 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-gray-600 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'events' ? (<div className="space-y-8">
        {clubEvents.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {clubEvents.map(event => (
              <div key={event.id}>
                <EventCard event={event} linkPrefix="/events" timeZone={(event.cityId && cityTimeZones[event.cityId]) || DEFAULT_TZ} />
                {memberAttendeesByEvent[event.id]?.length > 0 && (
                  <AttendeeStack attendees={memberAttendeesByEvent[event.id]} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-card p-12 text-center">
            <span className="text-4xl block mb-3">📅</span>
            <p className="text-gray-600">No events scheduled yet. Check back soon!</p>
            <button
              onClick={() => setTab('wall')}
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-amber-600 hover:text-amber-700 transition-colors">
              Start a conversation →
            </button>
          </div>
        )}
        {/* §17 — spontaneous plans shared with this club. */}
        <ClubHangouts slug={slug} clubId={clubId} isMember={isMember} />
      </div>
      ) : tab === 'wall' ? (
        <div className="space-y-10">
          <section>
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-3 flex items-center gap-2">
              <span>📢</span> Announcements
            </h3>
            <ClubAnnouncements
              slug={slug}
              canAnnounce={canAnnounce}
              currentUserId={currentUserId}
              isAdmin={isAdmin || canAnnounce}
            />
          </section>

          <section>
            {/* Conversations are canonical Board posts tagged to this club
                (§18) — the legacy wall (club_posts) was migrated in
                phase 2 and its writes retire here. */}
            <ClubConversations slug={slug} isMember={isMember} />
          </section>
        </div>
      ) : tab === 'photos' ? (
        <ClubPhotos
          slug={slug}
          canUpload={canUpload}
          isMember={isMember}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canPin={canPin}
        />
      ) : tab === 'past' ? (
        <ClubPastEvents slug={slug} />
      ) : tab === 'reviews' ? (
        <ClubReviews slug={slug} isMember={isMember} />
      ) : (
        <ClubMembers slug={slug} />
      )}
    </div>
  )
}
