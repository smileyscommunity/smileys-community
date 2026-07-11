import { prisma } from './prisma'
import { APP_URL, SITE_URL } from './env'
import { todayIstanbul, resolveImageUrl, formatTime } from './data'

// Server-side builder for the weekly auto-newsletter. Produces the same
// card markup as the composer's insert buttons (events digest + 3 random
// clubs + new-member welcome) so automated and hand-sent issues look
// identical. Inline styles only — email clients strip stylesheets.

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const UTM = 'utm_source=newsletter&utm_medium=email'

// Per-section tints so the digest reads as distinct blocks at a glance:
// amber = events, violet = clubs, blue = board, green = new faces.
// Thin section divider — email-safe hr.
const DIVIDER = `<hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0 18px">`

function card(inner: string, bg = '#fafafa', border = '#f3f4f6'): string {
  return `<div style="border:1px solid ${border};border-radius:12px;padding:12px 16px;margin:0 0 8px;background:${bg}">${inner}</div>`
}

export async function buildWeeklyDigest(): Promise<{ subject: string; bodyHtml: string; preheader: string } | null> {
  const today = todayIstanbul()
  const end   = todayIstanbul(7)

  const weekAgoStr = todayIstanbul(-7)
  const weekAgoDate = new Date(Date.now() - 7 * 86_400_000)

  const [events, clubs, newMembers, photos, eventsHeld, checkins, newConnections, listings] = await Promise.all([
    prisma.event.findMany({
      where:   { status: 'published', date: { gte: today, lte: end } },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      select:  { id: true, title: true, date: true, time: true, neighborhood: true, emoji: true, spotsLeft: true, totalSpots: true },
    }),
    prisma.club.findMany({
      where:  { isPrivate: false, isActive: true },
      select: { slug: true, name: true, emoji: true, category: true, memberCount: true },
    }),
    prisma.user.findMany({
      where:   { status: 'approved', hiddenFromMembers: false, joinedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      orderBy: { joinedAt: 'desc' },
      select:  { name: true },
    }),
    // Photo of the week candidates — last 7 days of uploads, event attached.
    prisma.eventPhoto.findMany({
      where:   { createdAt: { gte: weekAgoDate } },
      orderBy: { createdAt: 'desc' },
      take:    30,
      select:  { url: true, event: { select: { id: true, title: true, emoji: true, _count: { select: { attendees: true } } } } },
    }),
    // Week-in-review counters.
    prisma.event.count({ where: { status: 'published', date: { gte: weekAgoStr, lt: today } } }),
    prisma.eventAttendee.count({ where: { checkedIn: true, event: { date: { gte: weekAgoStr, lt: today } } } }),
    prisma.memberConnection.count({ where: { status: 'accepted', updatedAt: { gte: weekAgoDate } } }),
    // Fresh community-board listings — newest 3 that are still live.
    prisma.listing.findMany({
      where:   { status: 'active', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take:    3,
      select:  { id: true, title: true, category: true, price: true, neighborhood: true },
    }),
  ])

  // An auto-issue with no events would be an empty shell — skip the week
  // instead of emailing 1,000 people about nothing.
  if (events.length === 0) return null

  // Events, grouped by day.
  const byDay = new Map<string, typeof events>()
  for (const e of events) {
    const list = byDay.get(e.date) ?? []
    list.push(e)
    byDay.set(e.date, list)
  }
  const eventSections = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, evs]) => {
    const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
    const cards = evs.map(e =>
      card(
        `<a href="${APP_URL}/events/${e.id}?${UTM}" style="color:#111827;font-weight:700;font-size:15px;text-decoration:none">${e.emoji ? `${e.emoji} ` : ''}${esc(e.title)}</a>` +
        `<div style="color:#92400e;font-size:13px;margin-top:3px">🕖 ${formatTime(e.time)}${e.neighborhood ? ` · 📍 ${esc(e.neighborhood)}` : ''}</div>` +
        // Urgency nudge — only when scarcity is real (≤3 seats, or ≥80% full).
        (e.spotsLeft > 0 && (e.spotsLeft <= 3 || (e.totalSpots > 0 && e.spotsLeft / e.totalSpots <= 0.2))
          ? `<div style="color:#dc2626;font-size:12px;font-weight:700;margin-top:3px">🔥 Only ${e.spotsLeft} spot${e.spotsLeft !== 1 ? 's' : ''} left</div>`
          : ''),
        '#fffbeb', '#fde68a',
      ),
    ).join('')
    return `<p style="color:#b45309;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px">${dayLabel}</p>${cards}`
  }).join('')
  // Warm opener — the wrapper contributes "Hi <FirstName>," — this follows it.
  let body = `<p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px">Happy Monday! Here are the latest activities we think you'll enjoy — our amazing hosts are ready to welcome you. Have a wonderful week 💛</p>`

  // Photo of the week — the most recent upload from the best-attended event
  // of the past 7 days. One image turns the digest from a listing into a
  // story; nothing sells "come to an event" like last week's faces.
  const bestPhoto = [...photos].sort((a, b) => (b.event?._count.attendees ?? 0) - (a.event?._count.attendees ?? 0))[0]
  if (bestPhoto?.event) {
    const resolved = resolveImageUrl(bestPhoto.url)
    const photoUrl = resolved.startsWith('http') ? resolved : `${SITE_URL}${resolved}?w=1200`
    body += `<div style="margin:0 0 20px">` +
      `<a href="${APP_URL}/events/${bestPhoto.event.id}?${UTM}">` +
      `<img src="${photoUrl}" alt="Photo from ${esc(bestPhoto.event.title)}" style="width:100%;border-radius:12px;display:block"/></a>` +
      `<p style="color:#6b7280;font-size:12px;margin:6px 0 0">📸 Last week at ${bestPhoto.event.emoji ? `${bestPhoto.event.emoji} ` : ''}${esc(bestPhoto.event.title)}</p>` +
      `</div>`
  }

  // Week in review — one line of momentum. Zero-valued stats are dropped;
  // if nothing happened at all, the line disappears entirely.
  const stats = [
    { n: eventsHeld,        label: eventsHeld === 1 ? 'event' : 'events' },
    { n: checkins,          label: 'check-ins' },
    { n: newConnections,    label: 'connections' },
    { n: newMembers.length, label: newMembers.length === 1 ? 'new member' : 'new members' },
  ].filter(x => x.n > 0)
  if (stats.length) {
    // Table layout — the one structure every mail client renders reliably.
    const cells = stats.map(x =>
      `<td style="text-align:center;padding:10px 4px;background:#fffbeb;border-radius:10px">` +
      `<div style="color:#b45309;font-size:20px;font-weight:800;line-height:1">${x.n}</div>` +
      `<div style="color:#92400e;font-size:11px;margin-top:3px">${x.label}</div></td>`,
    ).join('<td style="width:6px"></td>')
    body += `<p style="color:#9ca3af;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 6px">Last week at Smileys</p>` +
      `<table role="presentation" style="width:100%;border-collapse:separate;margin:0 0 20px"><tr>${cells}</tr></table>`
  }

  body += `${DIVIDER}<h3 style="font-size:17px;margin:0 0 4px">📅 This week's events</h3>${eventSections}`

  // 3 random clubs.
  const picks = [...clubs].sort(() => Math.random() - 0.5).slice(0, 3)
  if (picks.length) {
    const clubCards = picks.map(c => {
      const meta = [c.category, c.memberCount ? `${c.memberCount} members` : null].filter(Boolean).join(' · ')
      return card(
        `<a href="${APP_URL}/clubs/${c.slug}?${UTM}" style="color:#111827;font-weight:700;font-size:15px;text-decoration:none">${c.emoji ? `${c.emoji} ` : ''}${esc(c.name)}</a>` +
        (meta ? `<div style="color:#6d28d9;font-size:13px;margin-top:3px">${esc(meta)}</div>` : ''),
        '#f5f3ff', '#ddd6fe',
      )
    }).join('')
    body += `${DIVIDER}<h3 style="font-size:17px;margin:0 0 8px">✨ Clubs to check out</h3>${clubCards}`
  }

  // Community board — pull-based discovery otherwise; this gives the
  // board a weekly heartbeat in every inbox.
  if (listings.length > 0) {
    const CAT_EMOJI: Record<string, string> = {
      ROOMS: '🏠', JOBS: '💼', SERVICES: '🛠️', BUY_SELL: '🛍️', FREE: '🎁',
      LOST_FOUND: '🔍', RECO: '⭐', EXPERIENCES: '🎟️', PETS: '🐾',
    }
    const CAT_LABEL: Record<string, string> = {
      ROOMS: 'Rooms', JOBS: 'Jobs', SERVICES: 'Services', BUY_SELL: 'Buy & Sell',
      FREE: 'Free stuff', LOST_FOUND: 'Lost & Found', RECO: 'Recommendation',
      EXPERIENCES: 'Experiences', PETS: 'Adopt a Pet',
    }
    const listingCards = listings.map(l => {
      const meta = [CAT_LABEL[l.category] ?? l.category, l.neighborhood, l.price].filter(Boolean).map(x => esc(String(x))).join(' · ')
      return card(
        `<a href="${APP_URL}/listings/${l.id}?${UTM}" style="color:#111827;font-weight:700;font-size:15px;text-decoration:none">${CAT_EMOJI[l.category] ?? '📌'} ${esc(l.title)}</a>` +
        (meta ? `<div style="color:#1d4ed8;font-size:13px;margin-top:3px">${meta}</div>` : ''),
        '#eff6ff', '#bfdbfe',
      )
    }).join('')
    body += `${DIVIDER}<h3 style="font-size:17px;margin:0 0 8px">🛍️ Fresh on the community board</h3>${listingCards}` +
      `<a href="${APP_URL}/listings?${UTM}" style="display:inline-block;margin:2px 0 0;color:#1d4ed8;font-weight:600;font-size:13px;text-decoration:none">Browse all listings →</a>` +
      `<div style="color:#6b7280;font-size:12px;margin-top:6px">Hunting for a room or a job? <a href="${APP_URL}/listings?${UTM}" style="color:#1d4ed8;font-weight:600;text-decoration:none">Set an instant alert</a> and get an email the moment one is posted.</div>`
  }

  // New-member welcome.
  if (newMembers.length > 0) {
    const firstNames = newMembers.map(m => esc(m.name.split(' ')[0]))
    const shown = firstNames.slice(0, 3)
    const rest  = newMembers.length - shown.length
    const who = rest > 0
      ? `${shown.join(', ')} and ${rest} other${rest !== 1 ? 's' : ''}`
      : shown.length > 1
        ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
        : shown[0]
    body += `${DIVIDER}<h3 style="font-size:17px;margin:0 0 8px">👋 New faces this week</h3>` +
      card(
        `<div style="color:#374151;font-size:14px">${who} joined Smileys this week — say hi when you see them at an event!</div>` +
        `<a href="${APP_URL}/members?${UTM}" style="display:inline-block;margin-top:6px;color:#15803d;font-weight:600;font-size:13px;text-decoration:none">Meet the members →</a>`,
        '#f0fdf4', '#bbf7d0',
      )
  }

  // Closing invite nudge — growth happens friend by friend; every issue
  // ends with the referral door open.
  body += DIVIDER + `<div style="margin-top:0;padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px">` +
    `<div style="color:#374151;font-size:14px">Know someone who'd love Smileys? Great communities grow friend by friend.</div>` +
    `<a href="${APP_URL}/invite?${UTM}" style="display:inline-block;margin-top:6px;color:#b45309;font-weight:700;font-size:13px;text-decoration:none">💛 Invite a friend →</a>` +
    `</div>`

  const preheaderParts = [
    `${events.length} event${events.length !== 1 ? 's' : ''} this week`,
    newMembers.length ? `${newMembers.length} new member${newMembers.length !== 1 ? 's' : ''}` : null,
    listings.length ? 'fresh board listings' : null,
  ].filter(Boolean)
  // Content-derived subject — identical subjects make Gmail thread the
  // issues together and readers tune them out. Lead with the soonest event.
  const lead = events[0].title.length > 40 ? `${events[0].title.slice(0, 39)}…` : events[0].title
  const subject = events.length > 1
    ? `This week in Istanbul: ${lead} + ${events.length - 1} more 📅`
    : `This week in Istanbul: ${lead} 📅`
  return { subject, bodyHtml: body, preheader: preheaderParts.join(' · ') }
}
