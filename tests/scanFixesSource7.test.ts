import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('cup results auto-apply', () => {
  it('commits the fixture and its prediction scoring in one transaction', () => {
    const src = read('lib/cup-results-sweep.ts')
    expect(src).toMatch(/prisma\.\$transaction\(async tx => \{\s*await tx\.cupFixture\.update\(\{ where: \{ id: fixture\.id \}, data: applyData \}\)\s*await scoreFixture\(fixture\.id, tx\)/)
  })
})

describe('cup prize PATCH', () => {
  it('leaves description and image alone when the body omits them', () => {
    const src = read('app/api/admin/cup/prizes/route.ts')
    expect(src).toMatch(/!\(key in body\) \? undefined/)
    expect(src).not.toMatch(/const description = typeof body\.description === 'string' \? [^\n]* : null/)
  })
})

describe('RSVP-tied emails', () => {
  it('no longer carry an "unsubscribe from event reminders" link that only switched off newsletters', () => {
    const src = read('lib/email.ts')
    expect(src).not.toContain('Unsubscribe from event reminders')
    expect((src.match(/you have a spot at this event\. <a href="\$\{APP_URL\}\/settings"/g) ?? []).length).toBe(6)
  })
})

describe('moderation queue', () => {
  it('never lists a report against the viewer (survey responders stay anonymous to the host)', () => {
    expect(read('app/api/admin/moderation/route.ts')).toMatch(/where:\s*\{ \.\.\.cityFilter, reportedId: \{ not: session\.id \} \}/)
  })
})

describe('host RSVP notifications', () => {
  it('pending requests carry their own link and only "joined" notifications seed a bundle', () => {
    expect(read('app/api/events/[id]/rsvp/route.ts')).toMatch(/participants\?tab=pending`\)/)
    const notify = read('lib/notify.ts')
    expect(notify).toMatch(/if \(existing && \/joined\|signed up\/\.test/)
    expect(notify).toMatch(/existing\.body\.match\(\/"\(\[\^"\]\+\)"\/\)/)
  })
})

describe('private club roster', () => {
  it('is members-and-staff only on the API and the tab is hidden from outsiders', () => {
    const api = read('app/api/clubs/[slug]/members/route.ts')
    expect(api).toMatch(/if \(club\.isPrivate && !canActInCity\(session, club\.cityId\)\) \{[\s\S]*?'Members only'/)
    const tabs = read('app/(member)/clubs/[slug]/ClubTabs.tsx')
    expect(tabs).toMatch(/\.filter\(t => t\.key !== 'members' \|\| !isPrivate \|\| isMember \|\| isAdmin\)/)
    expect(read('app/(member)/clubs/[slug]/page.tsx')).toContain('isPrivate={club.isPrivate ?? false}')
  })
})

describe('event photo gallery', () => {
  const src = read('app/api/events/[id]/photos/route.ts')
  it('is readable by attendees, hosts, co-hosts and staff only, with a typed caption', () => {
    expect(src).toMatch(/if \(!await canSeeEventInside\(session, id\)\)/)
    expect(src).toMatch(/caption != null && typeof caption !== 'string'/)
    expect(src).toMatch(/caption\.trim\(\)\.slice\(0, 300\)/)
  })
})

describe('hangout references', () => {
  it('return only the caller\'s own verdicts', () => {
    const src = read('app/api/hangouts/[id]/references/route.ts')
    expect(src).not.toMatch(/references: refs,/)
    expect(src).toMatch(/myReferences: mineByTarget,/)
  })
})

describe('members list', () => {
  it('gates socials and last-active on a connection like the profile route', () => {
    const src = read('app/api/members/route.ts')
    expect(src).toMatch(/const fullFor = \(id: string\) => id === session\.id \|\| privileged \|\| connectionIds\.has\(id\)/)
    expect(src).toMatch(/instagram: fullFor\(m\.id\) \? m\.instagram : null, linkedin: fullFor\(m\.id\) \? m\.linkedin : null, lastActive: fullFor\(m\.id\) \? m\.lastActive : null/)
  })
})
