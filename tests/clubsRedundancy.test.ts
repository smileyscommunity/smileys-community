import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Clubs page (Nate, 2026-09-29): one club, one place per screen, and the
// live clubs first — 14 of Istanbul's 148 had anything coming up.
const src = readFileSync(join(process.cwd(), 'app/clubs/ClubsClient.tsx'), 'utf8')

describe('clubs explore tab', () => {
  it('no "Coming up in your clubs" box and no "Active this week" strip repeating the sections', () => {
    expect(src).not.toContain('Coming up in your clubs</h2>')
    expect(src).not.toContain('Active this week</h2>')
    expect(src).not.toContain('const comingUp')
  })
  it('your own clubs (joined or pending) are not in Explore', () => {
    expect(src).toContain('const notMine = useMemo(() => clubs.filter(c => !mineIds.has(c.id)), [clubs, mineIds])')
    expect(src).toContain('() => notMine.filter(matches).sort((a, b) =>')
  })
  it('four sections, each club in the first it qualifies for', () => {
    expect(src).toContain('const soon = exploreBase.filter(c => c.nextEvent)')
    expect(src).toContain("const lately = exploreBase.filter(c => !c.nextEvent && (c.health === 'active' || c.health === 'new'))")
    expect(src).toContain('const global = exploreBase.filter(c => !taken.has(c.id) && (c.isGlobal ?? c.cityId == null))')
    expect(src).toContain('const quiet  = exploreBase.filter(c => !taken.has(c.id) && !(c.isGlobal ?? c.cityId == null))')
    for (const h of ['Happening soon', 'Active lately', 'Languages &amp; cultures', 'Looking for a host']) expect(src).toContain(`>${h}</h2>`)
  })
  it('the card is compact and leads with what\'s on', () => {
    expect(src).not.toContain('line-clamp-2 mt-1 leading-relaxed">{club.description}')
    expect(src).toContain('{formatDay(club.nextEvent.date)} · {club.nextEvent.title}')
  })
  it('the count still covers every match', () => {
    expect(src).toContain("const shownCount   = tab === 'mine' ? myClubs.length : exploreBase.length")
    expect(src).toContain("['explore', 'Explore', notMine.length]")
  })
  it('the long tails open on request, and a search or filter shows every match', () => {
    expect(src).toContain('const GLOBAL_PREVIEW = 6')
    expect(src).toContain('const QUIET_PREVIEW  = 10')
    expect(src).toContain("const filtering = !!q || activeCategory !== 'All'")
    expect(src).toContain('Show all {sections.quiet.length} clubs looking for a host')
  })
})
