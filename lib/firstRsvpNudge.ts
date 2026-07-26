import { prisma } from './prisma'
import { sendFirstEventNudgeEmail } from './email'

// Deterministic "first RSVP" matcher + weekly email nudge. Targets approved
// members who have signed in but NEVER RSVP'd — the biggest funnel leak — and
// emails each ONE well-matched, low-pressure first-event suggestion. See
// project memory `project_first_rsvp_nudge` for the rationale and test results.

type Candidate = {
  id: string; title: string; date: string; time: string | null; neighborhood: string | null
  emoji: string | null; isFirstTimerFriendly: boolean; isPremium: boolean
  limitedSpots: boolean; spotsLeft: number; attendees: number
}

// Istanbul spans two continents; a cross-Bosphorus trip is a poor FIRST event.
const EUROPEAN = new Set(['Beşiktaş','Beyoğlu','Şişli','Fatih','Sarıyer','Bakırköy','Kağıthane','Esenyurt','Beylikdüzü','Zeytinburnu','Eminönü','Taksim','Levent','Maslak','Ortaköy','Bebek','Etiler','Nişantaşı','Cihangir','Galata','Karaköy','Mecidiyeköy','Bomonti','Kılyos','Kilyos','Arnavutköy','Eyüp','Gaziosmanpaşa','Bağcılar','Avcılar'])
const ASIAN    = new Set(['Kadıköy','Üsküdar','Moda','Suadiye','Kozyatağı','Ataşehir','Maltepe','Kartal','Pendik','Bostancı','Çengelköy','Bağlarbaşı','Acıbadem','Fenerbahçe','Göztepe','Erenköy','Caddebostan','Kuzguncuk','Ümraniye','Bağdat','Kadikoy','Beykoz','Çekmeköy','Sancaktepe','Tuzla'])
function sideOf(hood: string | null): 'E' | 'A' | null {
  if (!hood) return null
  if (EUROPEAN.has(hood)) return 'E'
  if (ASIAN.has(hood)) return 'A'
  return null
}

function score(ev: Candidate, hood: string | null, daysAway: number): number | null {
  const mSide = sideOf(hood), eSide = sideOf(ev.neighborhood)
  if (mSide && eSide && mSide !== eSide) return null       // never cross the Bosphorus for a first event
  let s = 0
  if (hood && ev.neighborhood === hood) s += 100
  else if (mSide && eSide === mSide)    s += 35
  if (ev.isFirstTimerFriendly)          s += 60
  s += Math.max(0, 42 - daysAway)
  s += 5 * Math.min(ev.attendees, 6)
  if (ev.isPremium)                     s -= 40
  return s
}

// Member interests → keywords that show up in event titles. Events carry no
// category/vibe data in practice (all `vibes` empty), so the title is the only
// signal — but titles are descriptive ("Sunset Sailing Cruise", "Book Club",
// "Blood on the Clocktower"). A title match on a stated interest is a strong
// "this is for you" signal for a first event.
const INTEREST_KEYWORDS: Record<string, string[]> = {
  outdoor: ['picnic','hike','walk','park','beach','cruise','sail','outdoor','trek','trail'],
  social: ['social','mixer','drinks','hangout','meetup','party','sip','pub','bar'],
  games: ['game','clocktower','trivia','quiz','board','chess','poker','mafia','werewolf'],
  sailing: ['sail','cruise','boat','yacht'],
  wellness: ['meditation','yoga','wellness','mindful','breath','pilates','run','sound bath'],
  dining: ['dinner','brunch','food','dining','tasting','supper','feast','lunch'],
  networking: ['networking','coworking','business','startup','professional'],
  languages: ['language','exchange','practice','español','français','deutsch','turkish'],
  film: ['movie','film','cinema','screening'],
  music: ['music','concert','jam','karaoke','gig','vinyl'],
  reading: ['book','reading','literature','poetry'],
  hiking: ['hike','trek','trail','walk','mountain'],
  cooking: ['cook','baking','kitchen','recipe'],
  art: ['art','gallery','paint','museum','craft','pottery','draw'],
  photography: ['photo','photography'],
  dancing: ['dance','salsa','tango','bachata'],
  coffee: ['coffee','cafe','brunch'],
  'food & drink': ['food','drink','dinner','brunch','tasting','wine','beer'],
}
function interestBoost(interests: string[], title: string): number {
  const t = title.toLowerCase()
  for (const raw of interests) {
    const i = raw.toLowerCase()
    if (i.length >= 4 && t.includes(i)) return 45                 // the interest word itself is in the title
    const kws = INTEREST_KEYWORDS[i]
    if (kws && kws.some(k => t.includes(k))) return 45            // a mapped keyword is in the title
  }
  return 0
}

const SOFT_CAP = 25
function eventCap(ev: Candidate): number {
  return ev.limitedSpots ? Math.max(1, Math.min(ev.spotsLeft, SOFT_CAP)) : SOFT_CAP
}

function istanbulDateStr(offsetDays = 0): string {
  const ms = Date.now() + offsetDays * 86_400_000
  const ist = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }))
  return ist.toISOString().slice(0, 10)
}

export interface NudgeResult {
  segment: number; candidates: number; matched: number; emailed: number; failed: number
  sameHood: number; firstTimerFriendly: number; interestMatched: number
  priorNudged: number; priorConverted: number   // members nudged ≥3d ago, and how many have since RSVP'd
}

// Run the matcher and (unless dryRun) email each matched member once, stamping
// firstRsvpNudgedAt so they're excluded for the next 30 days. `limit` caps the
// number of emails (used for test sends).
export async function runFirstRsvpNudge(opts: { dryRun?: boolean; limit?: number } = {}): Promise<NudgeResult> {
  const dryRun = opts.dryRun ?? false
  const limit  = opts.limit ?? Infinity

  const from = istanbulDateStr(1)
  const to   = istanbulDateStr(21)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)

  const [members, rawEvents] = await Promise.all([
    prisma.user.findMany({
      where: {
        status: 'approved',
        lastActive: { not: null },
        emailMarketing: true,
        joinedEvents: { none: {} },                                              // never RSVP'd
        OR: [{ firstRsvpNudgedAt: null }, { firstRsvpNudgedAt: { lt: thirtyDaysAgo } }], // not nudged in 30d
      },
      select: { id: true, name: true, neighborhood: true, email: true, interests: true },
    }),
    prisma.event.findMany({
      where: { status: 'published', date: { gte: from, lte: to } },
      select: {
        id: true, title: true, date: true, time: true, neighborhood: true, emoji: true,
        isFirstTimerFriendly: true, isPremium: true, limitedSpots: true, spotsLeft: true,
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
    }),
  ])

  const candidates: Candidate[] = rawEvents
    .map(e => ({
      id: e.id, title: e.title, date: e.date, time: e.time, neighborhood: e.neighborhood,
      emoji: e.emoji, isFirstTimerFriendly: e.isFirstTimerFriendly, isPremium: e.isPremium,
      limitedSpots: e.limitedSpots, spotsLeft: e.spotsLeft, attendees: e._count.attendees,
    }))
    .filter(e => (!e.limitedSpots || e.spotsLeft > 0) && e.attendees >= 1)   // room + ≥1 going

  const dayIndex = (d: string) => Math.round((Date.parse(d + 'T00:00:00') - Date.parse(from + 'T00:00:00')) / 86_400_000)
  const remaining = new Map<string, number>()
  for (const ev of candidates) remaining.set(ev.id, eventCap(ev))

  const matches: { member: typeof members[number]; ev: Candidate; sameHood: boolean }[] = []
  for (const m of members) {
    const ranked = candidates
      .map(ev => {
        const base = score(ev, m.neighborhood, dayIndex(ev.date))
        return { ev, sc: base === null ? null : base + interestBoost(m.interests, ev.title) }
      })
      .filter((x): x is { ev: Candidate; sc: number } => x.sc !== null)
      .sort((a, b) => b.sc - a.sc)
    for (const { ev } of ranked) {
      const left = remaining.get(ev.id) ?? 0
      if (left > 0) { remaining.set(ev.id, left - 1); matches.push({ member: m, ev, sameHood: !!m.neighborhood && ev.neighborhood === m.neighborhood }); break }
    }
  }

  // Running attribution: members nudged ≥3 days ago (had a chance to act) who
  // now have any RSVP. They had zero RSVPs when nudged, so this is clean.
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
  const [priorNudged, priorConverted] = await Promise.all([
    prisma.user.count({ where: { firstRsvpNudgedAt: { not: null, lt: threeDaysAgo } } }),
    prisma.user.count({ where: { firstRsvpNudgedAt: { not: null, lt: threeDaysAgo }, joinedEvents: { some: {} } } }),
  ])

  const result: NudgeResult = {
    segment: members.length, candidates: candidates.length, matched: matches.length,
    emailed: 0, failed: 0,
    sameHood: matches.filter(x => x.sameHood).length,
    firstTimerFriendly: matches.filter(x => x.ev.isFirstTimerFriendly).length,
    interestMatched: matches.filter(x => interestBoost(x.member.interests, x.ev.title) > 0).length,
    priorNudged, priorConverted,
  }
  if (dryRun) return result

  const toSend = Number.isFinite(limit) ? matches.slice(0, limit) : matches
  for (const x of toSend) {
    try {
      await sendFirstEventNudgeEmail(x.member.id, x.member.email!, x.member.name, {
        id: x.ev.id, title: x.ev.title, date: x.ev.date, time: x.ev.time, neighborhood: x.ev.neighborhood,
        emoji: x.ev.emoji, attendees: x.ev.attendees, isFirstTimerFriendly: x.ev.isFirstTimerFriendly,
      })
      await prisma.user.update({ where: { id: x.member.id }, data: { firstRsvpNudgedAt: new Date() } })
      result.emailed++
    } catch {
      result.failed++
    }
    await new Promise(r => setTimeout(r, 100))   // gentle pacing for Resend
  }
  return result
}
