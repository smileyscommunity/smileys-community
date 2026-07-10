import { prisma } from './prisma'
import { APP_URL, SITE_URL } from './env'
import { todayIstanbul, resolveImageUrl } from './data'

// Server-side builder for the weekly auto-newsletter. Produces the same
// card markup as the composer's insert buttons (events digest + 3 random
// clubs + new-member welcome) so automated and hand-sent issues look
// identical. Inline styles only — email clients strip stylesheets.

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const UTM = 'utm_source=newsletter&utm_medium=email'

function card(inner: string): string {
  return `<div style="border:1px solid #f3f4f6;border-radius:12px;padding:12px 16px;margin:0 0 8px;background:#fafafa">${inner}</div>`
}

export async function buildWeeklyDigest(): Promise<{ subject: string; bodyHtml: string } | null> {
  const today = todayIstanbul()
  const end   = todayIstanbul(7)

  const weekAgoStr = todayIstanbul(-7)
  const weekAgoDate = new Date(Date.now() - 7 * 86_400_000)

  const [events, clubs, newMembers, photos, eventsHeld, checkins, newConnections] = await Promise.all([
    prisma.event.findMany({
      where:   { status: 'published', date: { gte: today, lte: end } },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      select:  { id: true, title: true, date: true, neighborhood: true, emoji: true },
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
        (e.neighborhood ? `<div style="color:#6b7280;font-size:13px;margin-top:3px">📍 ${esc(e.neighborhood)}</div>` : ''),
      ),
    ).join('')
    return `<p style="color:#b45309;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px">${dayLabel}</p>${cards}`
  }).join('')
  let body = ''

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
  const statParts = [
    eventsHeld     ? `<strong>${eventsHeld}</strong> event${eventsHeld !== 1 ? 's' : ''}` : null,
    checkins       ? `<strong>${checkins}</strong> check-in${checkins !== 1 ? 's' : ''}` : null,
    newConnections ? `<strong>${newConnections}</strong> new connection${newConnections !== 1 ? 's' : ''}` : null,
    newMembers.length ? `<strong>${newMembers.length}</strong> new member${newMembers.length !== 1 ? 's' : ''}` : null,
  ].filter(Boolean)
  if (statParts.length) {
    body += `<p style="color:#6b7280;font-size:13px;margin:0 0 20px">Last week at Smileys: ${statParts.join(' · ')}</p>`
  }

  body += `<h3 style="font-size:17px;margin:0 0 4px">📅 This week's events</h3>${eventSections}`

  // 3 random clubs.
  const picks = [...clubs].sort(() => Math.random() - 0.5).slice(0, 3)
  if (picks.length) {
    const clubCards = picks.map(c => {
      const meta = [c.category, c.memberCount ? `${c.memberCount} members` : null].filter(Boolean).join(' · ')
      return card(
        `<a href="${APP_URL}/clubs/${c.slug}?${UTM}" style="color:#111827;font-weight:700;font-size:15px;text-decoration:none">${c.emoji ? `${c.emoji} ` : ''}${esc(c.name)}</a>` +
        (meta ? `<div style="color:#6b7280;font-size:13px;margin-top:3px">${esc(meta)}</div>` : ''),
      )
    }).join('')
    body += `<h3 style="font-size:17px;margin:20px 0 8px">✨ Clubs to check out</h3>${clubCards}`
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
    body += `<h3 style="font-size:17px;margin:20px 0 8px">👋 New faces this week</h3>` +
      card(
        `<div style="color:#374151;font-size:14px">${who} joined Smileys this week — say hi when you see them at an event!</div>` +
        `<a href="${APP_URL}/members?${UTM}" style="display:inline-block;margin-top:6px;color:#b45309;font-weight:600;font-size:13px;text-decoration:none">Meet the members →</a>`,
      )
  }

  return { subject: 'This week at Smileys 📅', bodyHtml: body }
}
