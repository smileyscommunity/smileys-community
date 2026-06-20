import Link from 'next/link'
import { getInitials } from '@/lib/data'

// Unified club activity feed for the dashboard. Replaces two single-
// purpose widgets ("Club wall" + "New in your clubs") that each showed
// one type of event and were rendered via an if/else fallback — only
// one of the two was ever visible at a time, so the dashboard never
// surfaced new posts AND new members on the same day.
//
// The three sources are merged client-side from already-fetched server
// data (no new round-trip). Sorted by createdAt desc and trimmed to a
// fixed cap so the card never grows past a predictable height.

type MemberJoin = {
  joinedAt: Date | string
  user: { name: string; color: string }
  club: { name: string; emoji: string; slug: string }
}

type WallPost = {
  id: string
  type?: string
  content: string
  createdAt: Date | string
  user: { name: string; color: string; profilePhoto: string | null }
  club: { name: string; emoji: string; slug: string }
}

type NewEvent = {
  id: string
  title: string
  emoji: string
  createdAt: Date | string
  club: { name: string; emoji: string; slug: string } | null
}

type PhotoItem = {
  id: string
  url: string
  caption: string | null
  createdAt: Date | string
  href: string
  title: string
  user: { name: string; color: string }
}

type EventRsvp = {
  joinedAt: Date | string
  user:  { name: string; color: string }
  event: { id: string; title: string; emoji: string }
}

type NewMember = {
  id: string
  name: string
  color: string
  joinedAt: Date | string
  neighborhood?: string | null
}

type NewHangout = {
  id: string
  title: string
  neighborhood: string | null
  createdAt: Date | string
  user: { name: string; color: string }
}

type NewConnection = {
  updatedAt:  Date | string
  requester:  { name: string; color: string }
  receiver:   { name: string; color: string }
}

type GoodReference = {
  createdAt: Date | string
  fromUser:  { name: string; color: string }
  hangout:   { id: string; title: string }
}

interface Props {
  members:      MemberJoin[]
  posts:        WallPost[]
  events:       NewEvent[]
  photos?:      PhotoItem[]
  rsvps?:       EventRsvp[]
  newMembers?:  NewMember[]
  hangouts?:    NewHangout[]
  connections?: NewConnection[]
  references?:  GoodReference[]
  cap?:         number
}

type TimelineItem =
  | { kind: 'member';     ts: number; data: MemberJoin    }
  | { kind: 'post';       ts: number; data: WallPost      }
  | { kind: 'event';      ts: number; data: NewEvent      }
  | { kind: 'photo';      ts: number; data: PhotoItem     }
  | { kind: 'rsvp';       ts: number; data: EventRsvp     }
  | { kind: 'newmember';  ts: number; data: NewMember     }
  | { kind: 'hangout';    ts: number; data: NewHangout    }
  | { kind: 'connection'; ts: number; data: NewConnection }
  | { kind: 'reference';  ts: number; data: GoodReference }

// "2h", "3d", "Just now". Tighter than a full sentence — the card is
// narrow and the relative gap (recent vs. days old) is the only thing
// that matters at a glance.
function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)   return 'now'
  if (mins < 60)  return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs  < 24)  return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days}d`
  const wks = Math.floor(days / 7)
  return `${wks}w`
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
         style={{ backgroundColor: color }}>
      {getInitials(name)}
    </div>
  )
}

export default function ClubActivityTimeline({ members, posts, events, photos = [], rsvps = [], newMembers = [], hangouts = [], connections = [], references = [], cap = 6 }: Props) {
  const items: TimelineItem[] = [
    ...members    .map(m => ({ kind: 'member'     as const, ts: new Date(m.joinedAt).getTime(),   data: m })),
    ...posts      .map(p => ({ kind: 'post'       as const, ts: new Date(p.createdAt).getTime(),  data: p })),
    ...events     .map(e => ({ kind: 'event'      as const, ts: new Date(e.createdAt).getTime(),  data: e })),
    ...photos     .map(p => ({ kind: 'photo'      as const, ts: new Date(p.createdAt).getTime(),  data: p })),
    ...rsvps      .map(r => ({ kind: 'rsvp'       as const, ts: new Date(r.joinedAt).getTime(),   data: r })),
    ...newMembers .map(m => ({ kind: 'newmember'  as const, ts: new Date(m.joinedAt).getTime(),   data: m })),
    ...hangouts   .map(h => ({ kind: 'hangout'    as const, ts: new Date(h.createdAt).getTime(),  data: h })),
    ...connections.map(c => ({ kind: 'connection' as const, ts: new Date(c.updatedAt).getTime(),  data: c })),
    ...references .map(r => ({ kind: 'reference'  as const, ts: new Date(r.createdAt).getTime(),  data: r })),
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, cap)

  if (items.length === 0) return null

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <h2 className="text-sm font-bold text-gray-900 mb-3">Recent activity</h2>
      <div className="space-y-3">
        {items.map((it, i) => {
          if (it.kind === 'member') {
            const { user, club } = it.data
            return (
              <div key={`m-${i}`} className="flex items-center gap-2.5">
                <Avatar name={user.name} color={user.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{user.name.split(' ')[0]}</span>
                  {' joined '}
                  <Link href={`/clubs/${club.slug}`} className="font-semibold text-amber-600 hover:underline">
                    {club.emoji} {club.name}
                  </Link>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </div>
            )
          }
          if (it.kind === 'post') {
            const { user, club, content, type } = it.data
            const verb = type === 'announcement' ? 'announced in' : 'posted in'
            return (
              <Link key={`p-${i}`} href={`/clubs/${club.slug}`}
                    className="flex gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-700 leading-snug">
                    <span className="font-semibold">{user.name.split(' ')[0]}</span>
                    {' '}{verb}{' '}
                    <span className="font-semibold text-amber-600">{club.emoji} {club.name}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{content}</p>
                </div>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'photo') {
            const { user, href, title } = it.data
            return (
              <Link key={`ph-${i}`} href={href}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{user.name.split(' ')[0]}</span>
                  {' posted photos · '}
                  <span className="font-semibold text-amber-600">{title}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'rsvp') {
            const { user, event } = it.data
            return (
              <Link key={`r-${i}`} href={`/events/${event.id}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{user.name.split(' ')[0]}</span>
                  {' is going to '}
                  <span className="font-semibold text-amber-600">{event.emoji} {event.title}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'newmember') {
            const { name, color, neighborhood } = it.data
            return (
              <div key={`nm-${i}`} className="flex items-center gap-2.5">
                <Avatar name={name} color={color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{name.split(' ')[0]}</span>
                  {' joined Smileys'}
                  {neighborhood && <span className="text-gray-500"> · {neighborhood}</span>}
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </div>
            )
          }
          if (it.kind === 'hangout') {
            const { id, title, neighborhood, user } = it.data
            return (
              <Link key={`h-${i}`} href={`/hangouts/${id}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{user.name.split(' ')[0]}</span>
                  {' posted a hangout'}
                  {neighborhood && <span className="text-gray-500"> · {neighborhood}</span>}
                  {' — '}
                  <span className="font-semibold text-amber-600">{title}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'connection') {
            const { requester, receiver } = it.data
            return (
              <div key={`c-${i}`} className="flex items-center gap-2.5">
                <div className="flex -space-x-2 shrink-0">
                  <Avatar name={requester.name} color={requester.color} />
                  <Avatar name={receiver.name}  color={receiver.color}  />
                </div>
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{requester.name.split(' ')[0]}</span>
                  {' and '}
                  <span className="font-semibold">{receiver.name.split(' ')[0]}</span>
                  {' connected'}
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </div>
            )
          }
          if (it.kind === 'reference') {
            const { fromUser, hangout } = it.data
            return (
              <Link key={`rf-${i}`} href={`/hangouts/${hangout.id}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={fromUser.name} color={fromUser.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{fromUser.name.split(' ')[0]}</span>
                  {' left a good reference for '}
                  <span className="font-semibold text-amber-600">{hangout.title}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          // event
          const { id, title, emoji, club } = it.data
          return (
            <Link key={`e-${i}`} href={`/events/${id}`}
                  className="flex gap-2.5 hover:opacity-80 transition-opacity">
              <div className="w-7 h-7 rounded-xl bg-amber-50 flex items-center justify-center text-base shrink-0">
                {emoji}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-700 leading-snug">
                  New event{club && (
                    <>
                      {' in '}
                      <span className="font-semibold text-amber-600">{club.emoji} {club.name}</span>
                    </>
                  )}
                </p>
                <p className="text-xs text-gray-900 font-semibold mt-0.5 line-clamp-1">{title}</p>
              </div>
              <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
