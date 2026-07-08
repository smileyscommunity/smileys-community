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
  poll?: { question: string } | null
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

type NewPulse = {
  id: string
  neighborhood: string | null
  note: string | null
  until: Date | string
  createdAt: Date | string
  user: { name: string; color: string }
}

type NewClub = {
  id: string
  name: string
  slug: string
  emoji: string
  createdAt: Date | string
}

type NewListing = {
  id: string
  title: string
  createdAt: Date | string
  user: { name: string; color: string }
}

type NewBusiness = {
  id: string
  name: string
  category: string
  createdAt: Date | string
}

type EventReview = {
  rating: number
  createdAt: Date | string
  user:  { name: string; color: string }
  event: { id: string; title: string; emoji: string }
}

type PlaceReview = {
  rating: number
  createdAt: Date | string
  author:   { name: string; color: string }
  business: { id: string; name: string }
}

type Visitor = {
  id: string
  name: string
  fromCity: string | null
  createdAt: Date | string
}

type HangoutJoinItem = {
  createdAt: Date | string
  user:    { name: string; color: string }
  hangout: { id: string; title: string }
}

type HoodPost = {
  id: string
  content: string
  neighborhood: string
  slug: string
  createdAt: Date | string
  user: { name: string; color: string }
}

type ClubResourceItem = {
  id: string
  title: string
  emoji: string
  createdAt: Date | string
  club: { name: string; emoji: string; slug: string }
}

type TestimonialItem = {
  id: string
  memberName: string
  quote: string
  createdAt: Date | string
}

type CupPick = {
  pickedTeam: string
  submittedAt: Date | string
  user: { name: string; color: string }
}

type CupDonation = {
  id: string
  donorName: string
  donorOrganization: string | null
  prizeTitle: string
  createdAt: Date | string
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
  pulses?:      NewPulse[]
  connections?: NewConnection[]
  references?:  GoodReference[]
  newClubs?:    NewClub[]
  listings?:     NewListing[]
  businesses?:   NewBusiness[]
  eventReviews?: EventReview[]
  placeReviews?: PlaceReview[]
  visitors?:     Visitor[]
  hangoutJoins?: HangoutJoinItem[]
  hoodPosts?:    HoodPost[]
  resources?:    ClubResourceItem[]
  testimonials?: TestimonialItem[]
  cupPicks?:     CupPick[]
  cupDonations?: CupDonation[]
  cap?:          number
}

type TimelineItem =
  | { kind: 'member';     ts: number; data: MemberJoin    }
  | { kind: 'post';       ts: number; data: WallPost      }
  | { kind: 'event';      ts: number; data: NewEvent      }
  | { kind: 'photo';      ts: number; data: PhotoItem     }
  | { kind: 'rsvp';       ts: number; data: EventRsvp     }
  | { kind: 'newmember';  ts: number; data: NewMember     }
  | { kind: 'hangout';    ts: number; data: NewHangout    }
  | { kind: 'pulse';      ts: number; data: NewPulse      }
  | { kind: 'connection'; ts: number; data: NewConnection }
  | { kind: 'reference';  ts: number; data: GoodReference }
  | { kind: 'club';       ts: number; data: NewClub       }
  | { kind: 'listing';    ts: number; data: NewListing    }
  | { kind: 'business';   ts: number; data: NewBusiness   }
  | { kind: 'eventreview';  ts: number; data: EventReview      }
  | { kind: 'placereview';  ts: number; data: PlaceReview      }
  | { kind: 'visitor';      ts: number; data: Visitor          }
  | { kind: 'hangoutjoin';  ts: number; data: HangoutJoinItem  }
  | { kind: 'hoodpost';     ts: number; data: HoodPost         }
  | { kind: 'resource';     ts: number; data: ClubResourceItem }
  | { kind: 'testimonial';  ts: number; data: TestimonialItem  }
  | { kind: 'cuppick';      ts: number; data: CupPick          }
  | { kind: 'cupdonation';  ts: number; data: CupDonation      }

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

export default function ClubActivityTimeline({ members, posts, events, photos = [], rsvps = [], newMembers = [], hangouts = [], pulses = [], connections = [], references = [], newClubs = [], listings = [], businesses = [], eventReviews = [], placeReviews = [], visitors = [], hangoutJoins = [], hoodPosts = [], resources = [], testimonials = [], cupPicks = [], cupDonations = [], cap = 6 }: Props) {
  const merged: TimelineItem[] = [
    ...members    .map(m => ({ kind: 'member'     as const, ts: new Date(m.joinedAt).getTime(),   data: m })),
    ...posts      .map(p => ({ kind: 'post'       as const, ts: new Date(p.createdAt).getTime(),  data: p })),
    ...events     .map(e => ({ kind: 'event'      as const, ts: new Date(e.createdAt).getTime(),  data: e })),
    ...photos     .map(p => ({ kind: 'photo'      as const, ts: new Date(p.createdAt).getTime(),  data: p })),
    ...rsvps      .map(r => ({ kind: 'rsvp'       as const, ts: new Date(r.joinedAt).getTime(),   data: r })),
    ...newMembers .map(m => ({ kind: 'newmember'  as const, ts: new Date(m.joinedAt).getTime(),   data: m })),
    ...hangouts   .map(h => ({ kind: 'hangout'    as const, ts: new Date(h.createdAt).getTime(),  data: h })),
    ...pulses     .map(p => ({ kind: 'pulse'      as const, ts: new Date(p.createdAt).getTime(),  data: p })),
    ...connections.map(c => ({ kind: 'connection' as const, ts: new Date(c.updatedAt).getTime(),  data: c })),
    ...references .map(r => ({ kind: 'reference'  as const, ts: new Date(r.createdAt).getTime(),  data: r })),
    ...newClubs   .map(c => ({ kind: 'club'       as const, ts: new Date(c.createdAt).getTime(),  data: c })),
    ...listings   .map(l => ({ kind: 'listing'    as const, ts: new Date(l.createdAt).getTime(),  data: l })),
    ...businesses .map(b => ({ kind: 'business'   as const, ts: new Date(b.createdAt).getTime(),  data: b })),
    ...eventReviews.map(r => ({ kind: 'eventreview' as const, ts: new Date(r.createdAt).getTime(),   data: r })),
    ...placeReviews.map(r => ({ kind: 'placereview' as const, ts: new Date(r.createdAt).getTime(),   data: r })),
    ...visitors    .map(v => ({ kind: 'visitor'     as const, ts: new Date(v.createdAt).getTime(),   data: v })),
    ...hangoutJoins.map(j => ({ kind: 'hangoutjoin' as const, ts: new Date(j.createdAt).getTime(),   data: j })),
    ...hoodPosts   .map(p => ({ kind: 'hoodpost'    as const, ts: new Date(p.createdAt).getTime(),   data: p })),
    ...resources   .map(r => ({ kind: 'resource'    as const, ts: new Date(r.createdAt).getTime(),   data: r })),
    ...testimonials.map(t => ({ kind: 'testimonial' as const, ts: new Date(t.createdAt).getTime(),   data: t })),
    ...cupPicks    .map(p => ({ kind: 'cuppick'     as const, ts: new Date(p.submittedAt).getTime(), data: p })),
    ...cupDonations.map(d => ({ kind: 'cupdonation' as const, ts: new Date(d.createdAt).getTime(),   data: d })),
  ].sort((a, b) => b.ts - a.ts)

  // Per-kind cap: high-frequency sources (RSVPs, joins, cup picks)
  // would otherwise own all `cap` slots on a busy day and bury the
  // rare items (a new club, a listing) that make the wall feel like
  // a community rather than a counter. Greedy fill by recency, but
  // no kind gets more than 3 of the visible slots.
  const PER_KIND_CAP = 3
  const kindCounts: Partial<Record<TimelineItem['kind'], number>> = {}
  const items: TimelineItem[] = []
  // Pin active pulses to the front first. A pulse is a "free right now"
  // signal that expires in a few hours, so it must not lose a visible slot
  // to a newer-but-less-urgent item (a photo, an RSVP). Still bounded by the
  // per-kind cap; `merged` is already recency-sorted so we take the freshest.
  for (const it of merged) {
    if (it.kind !== 'pulse') continue
    if ((kindCounts.pulse ?? 0) >= PER_KIND_CAP) break
    kindCounts.pulse = (kindCounts.pulse ?? 0) + 1
    items.push(it)
    if (items.length >= cap) break
  }
  // Then fill the remaining slots by recency, per-kind capped as before.
  for (const it of merged) {
    if (it.kind === 'pulse') continue
    if (items.length >= cap) break
    if ((kindCounts[it.kind] ?? 0) >= PER_KIND_CAP) continue
    kindCounts[it.kind] = (kindCounts[it.kind] ?? 0) + 1
    items.push(it)
  }

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
            const { user, club, content, type, poll } = it.data
            const verb = poll ? 'started a poll in' : type === 'announcement' ? 'announced in' : 'posted in'
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
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{content || poll?.question}</p>
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
          if (it.kind === 'pulse') {
            const { neighborhood, note, user } = it.data
            return (
              <Link key={`pl-${i}`} href="/hangouts"
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{user.name.split(' ')[0]}</span>
                  {' is around to hang out'}
                  {neighborhood && <span className="text-gray-500"> · {neighborhood}</span>}
                  {note && <span className="text-gray-400"> — {note}</span>}
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
          if (it.kind === 'eventreview') {
            const { user, event, rating } = it.data
            return (
              <Link key={`er-${i}`} href={`/events/${event.id}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{user.name.split(' ')[0]}</span>
                  {' rated '}
                  <span className="font-semibold text-amber-600">{event.emoji} {event.title}</span>
                  {' '}<span className="text-amber-500">{'★'.repeat(rating)}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'placereview') {
            const { author, business, rating } = it.data
            return (
              <Link key={`pr-${i}`} href={`/directory/${business.id}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={author.name} color={author.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{author.name.split(' ')[0]}</span>
                  {' reviewed '}
                  <span className="font-semibold text-amber-600">{business.name}</span>
                  {' '}<span className="text-amber-500">{'★'.repeat(rating)}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'visitor') {
            const { name, fromCity } = it.data
            return (
              <Link key={`v-${i}`} href="/visiting"
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <div className="w-7 h-7 rounded-xl bg-amber-50 flex items-center justify-center text-base shrink-0">
                  🧳
                </div>
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{name.split(' ')[0]}</span>
                  {' is visiting Istanbul'}
                  {fromCity && <span className="text-gray-500"> · from {fromCity}</span>}
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'hangoutjoin') {
            const { user, hangout } = it.data
            return (
              <Link key={`hj-${i}`} href={`/hangouts/${hangout.id}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{user.name.split(' ')[0]}</span>
                  {' joined a hangout — '}
                  <span className="font-semibold text-amber-600">{hangout.title}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'hoodpost') {
            const { user, neighborhood, slug, content } = it.data
            return (
              <Link key={`np-${i}`} href={`/neighborhoods/${slug}`}
                    className="flex gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-700 leading-snug">
                    <span className="font-semibold">{user.name.split(' ')[0]}</span>
                    {' posted in '}
                    <span className="font-semibold text-amber-600">{neighborhood}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{content}</p>
                </div>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'resource') {
            const { title, emoji, club } = it.data
            return (
              <Link key={`res-${i}`} href={`/clubs/${club.slug}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <div className="w-7 h-7 rounded-xl bg-amber-50 flex items-center justify-center text-base shrink-0">
                  {emoji}
                </div>
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  {'New resource in '}
                  <span className="font-semibold text-amber-600">{club.emoji} {club.name}</span>
                  {' — '}
                  <span className="font-semibold">{title}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'testimonial') {
            const { memberName, quote } = it.data
            return (
              <div key={`t-${i}`} className="flex gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-amber-50 flex items-center justify-center text-base shrink-0">
                  💬
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-700 leading-snug">
                    <span className="font-semibold">{memberName.split(' ')[0]}</span>
                    {' shared their Smileys story'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">“{quote}”</p>
                </div>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </div>
            )
          }
          if (it.kind === 'cuppick') {
            const { user, pickedTeam } = it.data
            return (
              <Link key={`cp-${i}`} href="/cup"
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{user.name.split(' ')[0]}</span>
                  {' predicted '}
                  <span className="font-semibold text-amber-600">{pickedTeam}</span>
                  {' to win ⚽'}
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'cupdonation') {
            const { donorName, donorOrganization, prizeTitle } = it.data
            return (
              <Link key={`cd-${i}`} href="/cup"
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <div className="w-7 h-7 rounded-xl bg-amber-50 flex items-center justify-center text-base shrink-0">
                  🎁
                </div>
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{donorOrganization || donorName}</span>
                  {' donated a Cup prize — '}
                  <span className="font-semibold text-amber-600">{prizeTitle}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'listing') {
            const { id, title, user } = it.data
            return (
              <Link key={`l-${i}`} href={`/listings/${id}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <Avatar name={user.name} color={user.color} />
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  <span className="font-semibold">{user.name.split(' ')[0]}</span>
                  {' posted a listing — '}
                  <span className="font-semibold text-amber-600">{title}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'business') {
            const { id, name, category } = it.data
            return (
              <Link key={`b-${i}`} href={`/directory/${id}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <div className="w-7 h-7 rounded-xl bg-amber-50 flex items-center justify-center text-base shrink-0">
                  📍
                </div>
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  {'New in the directory — '}
                  <span className="font-semibold text-amber-600">{name}</span>
                  <span className="text-gray-500"> · {category}</span>
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">{formatAgo(it.ts)}</span>
              </Link>
            )
          }
          if (it.kind === 'club') {
            const { name, slug, emoji } = it.data
            return (
              <Link key={`nc-${i}`} href={`/clubs/${slug}`}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
                <div className="w-7 h-7 rounded-xl bg-amber-50 flex items-center justify-center text-base shrink-0">
                  {emoji}
                </div>
                <p className="text-xs text-gray-700 leading-snug min-w-0 flex-1">
                  {'New club started — '}
                  <span className="font-semibold text-amber-600">{name}</span>
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
