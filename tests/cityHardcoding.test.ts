import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

// A ratchet on hardcoded city names in user-facing code.
//
// Smileys is a network of cities, but it grew out of one, so the default city's
// name is written into a lot of places that should ask which city they're in.
// Every one of those is invisible until a second city goes live and a member
// reads the wrong city's name on their own page. Bodrum's launch surfaced them
// one at a time, by eye, on a phone: "Istanbul Board" above Bodrum's listings,
// "Find your people in Istanbul" under a Bodrum hero, a shared Bodrum
// neighborhood previewing as Istanbul.
//
// Demanding zero would fail on day one and get deleted — there are 242 of them,
// most in copy that genuinely is about Istanbul (the Türkiye guide, "Founded in
// Istanbul"). So this locks in today's count per file instead:
//
//   · a NEW file with a hardcoded city name fails
//   · an EXISTING file gaining one fails
//   · removing them passes, and you're invited to lower the number
//
// The point is that the next hardcoded city name has to be a deliberate act
// with a baseline edit attached, rather than something noticed in production
// weeks later. When a file reaches zero, delete its line.
//
// Excluded as not-copy: the IANA zone Europe/Istanbul, asset filenames, the
// aswistanbul social handle, and identifiers that merely contain the word
// (IstanbulToday, istanbulEventWindow, todayIstanbul, …).

const CITY = 'Istanbul'
const ROOTS = ['app', 'components']
const NOISE = /Europe\/Istanbul|hero-istanbul|aswistanbul|istanbul\.jpg|IstanbulToday|MyIstanbul|istanbulEventWindow|todayIstanbul|toIstanbulInputValue|istanbulInputToISO/g
const COMMENT = /^\s*(\/\/|\*|\/\*)/

// file -> how many hardcoded mentions it had when this ratchet was set,
// 2026-08-17, the day Bodrum became the second live city.
const BASELINE: Record<string, number> = {
  'app/(member)/board/new/page.tsx': 1,
  'app/(member)/clubs/[slug]/page.tsx': 2,
  'app/(member)/cup/page.tsx': 1,
  'app/(member)/dashboard/page.tsx': 5,
  'app/(member)/directory/submit/page.tsx': 1,
  'app/(member)/hangouts/[id]/page.tsx': 1,
  'app/(member)/hangouts/page.tsx': 3,
  'app/(member)/invite/page.tsx': 3,
  'app/(member)/members/MemberDiscovery.tsx': 2,
  'app/(member)/members/[id]/page.tsx': 2,
  'app/(member)/visiting/new/page.tsx': 2,
  'app/[city]/page.tsx': 2,
  'app/about/page.tsx': 12,
  'app/admin/applications/page.tsx': 1,
  'app/admin/clubs/page.tsx': 2,
  'app/admin/content/page.tsx': 3,
  'app/admin/directory/page.tsx': 2,
  'app/admin/events/[id]/edit/page.tsx': 1,
  'app/admin/events/new/page.tsx': 1,
  'app/admin/guide/page.tsx': 1,
  'app/admin/hangouts/page.tsx': 3,
  'app/admin/newsletter/page.tsx': 3,  // +2: honest copy disclosing the auto digest is Istanbul-scoped (2026-08-19)
  'app/admin/posts/constants.ts': 1,
  'app/admin/posts/page.tsx': 1,
  'app/admin/spotlight/page.tsx': 2,
  'app/admin/stories/page.tsx': 1,
  'app/advertise/page.tsx': 12,
  'app/api/admin/applications/screen/route.ts': 3,
  'app/api/admin/applications/welcome/route.ts': 2,
  'app/api/admin/geocode/route.ts': 1,
  'app/api/admin/guide/route.ts': 1,
  'app/api/admin/moderation/triage/route.ts': 1,
  'app/api/admin/users/reengage/route.ts': 1,
  'app/api/auth/login/route.ts': 1,
  'app/api/events/[id]/feedback/route.ts': 1,
  'app/api/events/[id]/rsvp/route.ts': 1,
  'app/api/host/events/describe/route.ts': 1,
  'app/api/host/events/suggest-tags/route.ts': 1,
  'app/api/og/route.tsx': 2,
  'app/apply/layout.tsx': 5,
  'app/apply/page.tsx': 5,
  'app/clubs/layout.tsx': 4,
  'app/clubs/page.tsx': 1,
  'app/contact/page.tsx': 1,
  'app/directory/layout.tsx': 1,
  'app/directory/page.tsx': 1,
  'app/events/[id]/page.tsx': 9,
  'app/events/layout.tsx': 4,
  'app/events/page.tsx': 4,
  'app/faq/page.tsx': 3,
  'app/guide/GuideCTA.tsx': 2,
  'app/guide/IstanbulToday.tsx': 5,
  'app/guide/MyIstanbul.tsx': 1,
  'app/guide/[slug]/ExperienceActions.tsx': 2,
  'app/guide/[slug]/page.tsx': 4,
  'app/guide/layout.tsx': 7,
  'app/guide/page.tsx': 8,
  'app/guide/routes/[slug]/page.tsx': 4,
  'app/guidelines/page.tsx': 1,
  'app/handbook/page.tsx': 3,
  'app/host/events/[id]/edit/page.tsx': 2,
  'app/host/events/new/page.tsx': 1,
  'app/layout.tsx': 3,
  'app/neighborhoods/[slug]/page.tsx': 5,
  'app/neighborhoods/page.tsx': 5,
  'app/page.tsx': 1,
  'app/posts/[slug]/page.tsx': 2,
  'app/posts/page.tsx': 6,
  'app/privacy/page.tsx': 2,
  'app/pro/page.tsx': 2,
  'app/visiting/VisitingClient.tsx': 1,
  'app/visiting/page.tsx': 16,
  'app/why/page.tsx': 15,
  'components/ClubActivityTimeline.tsx': 1,
  'components/ClubConversations.tsx': 1,
  'components/DashboardVisitorsStrip.tsx': 1,
  'components/EventCard.tsx': 1,
  'components/EventTabs.tsx': 1,
  'components/FirstEventBlock.tsx': 1,
  'components/Footer.tsx': 6,
  'components/HandbookSearch.tsx': 2,
  'components/MovingSales.tsx': 2,
  'components/OnboardingCard.tsx': 3,
  'components/QuickLinks.tsx': 1,
  'components/ReferralImpact.tsx': 1,
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
  }
  return out
}

function countIn(file: string): number {
  let n = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (COMMENT.test(line)) continue
    n += (line.replace(NOISE, '').match(new RegExp(CITY, 'g')) ?? []).length
  }
  return n
}

const counts = new Map<string, number>()
for (const root of ROOTS) {
  for (const abs of walk(join(process.cwd(), root))) {
    const rel = relative(process.cwd(), abs)
    const n = countIn(abs)
    if (n > 0) counts.set(rel, n)
  }
}

describe('hardcoded city names do not spread', () => {
  it('finds files to scan (guards against a silently empty sweep)', () => {
    expect(counts.size).toBeGreaterThan(20)
  })

  it('no NEW file hardcodes the default city name', () => {
    const added = [...counts.keys()].filter(f => !(f in BASELINE)).sort()
    expect(added, `these files newly hardcode "${CITY}" — ask the page which city it is in (useCurrentCity, resolveCityForPage, or the city prop), or add them to BASELINE with a reason`).toEqual([])
  })

  it('no existing file gains more', () => {
    const grown = [...counts.entries()]
      .filter(([f, n]) => f in BASELINE && n > BASELINE[f])
      .map(([f, n]) => `${f}: ${BASELINE[f]} -> ${n}`)
      .sort()
    expect(grown, 'these files gained hardcoded city names').toEqual([])
  })
})
