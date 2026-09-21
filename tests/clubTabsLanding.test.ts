import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf8')

// 156 of the 166 active clubs have nothing coming up, and the club page always
// opened on Events. So Turkish — 114 members, 3 past events, 5 reviews — opened
// on "No events scheduled yet. Check back soon!" and read as a club that had
// never done anything. Hiking (311 members, 7 past events, 12 reviews), Arts,
// Cinema and Special Events all did the same.
//
// The same page then gave no clue where to look: Events, Members and Reviews
// carried counts, Conversations, Photos and Past Events did not, so a tab with
// three things in it looked exactly like a tab with none.

type Counts = {
  clubEvents: number; pastEventCount: number; reviewCount: number
  conversationCount: number; photoCount: number; memberCount: number
  membersAllowed?: boolean
}

// Mirror of firstWithSomething in ClubTabs; the source assertions below keep
// the two in step.
function landing(c: Counts): string {
  return c.clubEvents        > 0 ? 'events'
    : c.pastEventCount       > 0 ? 'past'
    : c.reviewCount          > 0 ? 'reviews'
    : c.conversationCount    > 0 ? 'wall'
    : c.photoCount           > 0 ? 'photos'
    : 'events'
}
const none = { clubEvents: 0, pastEventCount: 0, reviewCount: 0, conversationCount: 0, photoCount: 0, memberCount: 0 }

describe('which tab a club opens on', () => {
  it('Turkish opens on its past events, not on an empty Events tab', () => {
    expect(landing({ ...none, clubEvents: 0, pastEventCount: 3, reviewCount: 5, memberCount: 114 })).toBe('past')
  })

  it('a club with something coming up still opens on Events', () => {
    expect(landing({ ...none, clubEvents: 2, pastEventCount: 7, reviewCount: 12, memberCount: 311 })).toBe('events')
  })

  it('falls through in the order a newcomer wants: next, then done, then said', () => {
    expect(landing({ ...none, reviewCount: 4, memberCount: 50 })).toBe('reviews')
    expect(landing({ ...none, conversationCount: 2, memberCount: 50 })).toBe('wall')
    expect(landing({ ...none, photoCount: 6, memberCount: 50 })).toBe('photos')
  })

  // A roster is not something the club did, the header already says the
  // member count, and the tab now carries it too — while the empty Events
  // tab is the only place offering "Start a conversation". Sending every
  // contentless club to a list of faces would have hidden that on 118 of 166.
  it('a club with members but nothing to show still opens on Events, prompt and all', () => {
    expect(landing({ ...none, memberCount: 114 })).toBe('events')
    expect(landing(none)).toBe('events')
  })

  it('never lands on a roster at all, so a private club cannot leak one', () => {
    const src = read('app/(member)/clubs/[slug]/ClubTabs.tsx')
    // Just the fallback chain — 'members' appears later as a tab key.
    const chain = src.slice(src.indexOf('const firstWithSomething'), src.indexOf('const tab: Tab'))
    expect(chain).not.toContain("'members'")
    expect(chain).toContain("'past'")
  })
})

describe('the tabs say what is in them', () => {
  const src = read('app/(member)/clubs/[slug]/ClubTabs.tsx')

  it('every tab gets a count, through one helper', () => {
    expect(src).toContain("const withCount = (label: string, n: number) => n > 0 ? `${label} (${n})` : label")
    for (const label of ['Events', 'Conversations', 'Members', 'Photos', 'Past Events']) {
      expect(src, `${label} has no count`).toContain(`withCount('${label}'`)
    }
  })

  it('zero stays bare rather than showing (0)', () => {
    expect(src).toContain('n > 0 ?')
  })

  it('the page supplies the three counts that were missing', () => {
    const page = read('app/(member)/clubs/[slug]/page.tsx')
    expect(page).toContain('prisma.clubPost.count({ where: { clubId: club.id } })')
    expect(page).toContain('prisma.clubPhoto.count({ where: { clubId: club.id } })')
    expect(page).toContain('pastEventCount={pastEventCount}')
    expect(page).toContain('conversationCount={conversationCount}')
    expect(page).toContain('photoCount={photoCount}')
  })

  it('the default tab keeps the bare URL, whichever one it is', () => {
    // Otherwise Back cycles tabs instead of leaving the club, and a shared
    // link carries a ?tab= that was never chosen.
    expect(src).toContain('router.push(next === firstWithSomething ? pathname : `${pathname}?tab=${next}`')
  })
})

describe('a global club says so on its own page too', () => {
  it('the detail header carries the badge, not just the grid card', () => {
    const page = read('app/(member)/clubs/[slug]/page.tsx')
    expect(page).toContain('🌍 Across Smileys')
    expect(page).toContain('club.cityId == null &&')
  })

  it('the grid prefers the API field over deriving it again', () => {
    const client = read('app/clubs/ClubsClient.tsx')
    expect(client).toContain('club.isGlobal ?? club.cityId == null')
    expect(client).not.toMatch(/const isGlobal\s+= club\.cityId == null$/m)
  })
})
