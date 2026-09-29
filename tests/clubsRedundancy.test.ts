import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Clubs page (Nate, 2026-09-29): one club, one place per screen, and the
// live clubs first — 14 of Istanbul's 148 had anything coming up.
const src = readFileSync(join(process.cwd(), 'app/clubs/ClubsClient.tsx'), 'utf8')

describe('clubs explore tab', () => {
  it('one "your clubs" row, not a row plus a box; no "Active this week" strip', () => {
    expect(src.split('Coming up in your clubs</h2>').length - 1).toBe(1)
    expect(src).not.toContain('Active this week</h2>')
    expect(src).not.toContain('const comingUp')
  })
  // Nate 2026-09-29: "show my clubs lots of empty clubs" — the row showed
  // every joined club; half said "Nothing planned yet".
  it('the top row is only your clubs with something coming up; the rest are one tap away', () => {
    expect(src).toContain('() => joinedClubs.filter(c => c.nextEvent).sort((a, b) => a.nextEvent!.date.localeCompare(b.nextEvent!.date)),')
    // Every one with an event (Nate: "not just 4"), on the hero card.
    expect(src).toContain('{myUpcoming.map(club => renderCard(club))}')
    expect(src).not.toContain('myUpcoming.slice(0, 4)')
    expect(src).not.toContain('Nothing planned yet</p>')
    expect(src).toContain('All your clubs ({joinedClubs.length + pendingClubs.length}) →')
  })
  it('My Clubs: planned first as cards, quiet ones as a compact list', () => {
    expect(src).toContain('{myClubs.filter(c => c.nextEvent).map(club => renderCard(club))}')
    expect(src).toContain('>Nothing planned right now</h2>')
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
  // Nate 2026-09-29: clubs with an upcoming event get their cover as a hero.
  it('a club with an upcoming event shows its cover, at the 800px preview size', () => {
    expect(src).toContain('const heroSrc = club.nextEvent && club.coverImage ? resolveImageUrl(club.coverImage) : null')
    expect(src).toContain("heroSrc.startsWith('/app/api/files/') ? `${heroSrc}?w=800` : heroSrc")
    expect(src).toContain('<img src={hero} alt="" loading="lazy"')
  })
})
