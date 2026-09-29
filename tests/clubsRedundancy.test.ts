import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Clubs page redundancy (Nate, 2026-09-29): one club, one place per screen.
const src = readFileSync(join(process.cwd(), 'app/clubs/ClubsClient.tsx'), 'utf8')

describe('clubs explore tab shows each club once', () => {
  it('"Coming up in your clubs" is gone — "Your clubs" cards carry the next event', () => {
    expect(src).not.toContain('Coming up in your clubs</h2>')
    expect(src).not.toContain('const comingUp')
  })
  it('your own clubs (joined or pending) are not in the Explore grid or the strip', () => {
    expect(src).toContain('const notMine = useMemo(() => clubs.filter(c => !mineIds.has(c.id)), [clubs, mineIds])')
    expect(src).toContain('() => notMine.filter(matches).sort((a, b) =>')
    expect(src).toContain('() => notMine.filter(c => (c.activityThisWeek ?? 0) > 0)')
  })
  it('the grid leaves out the "Active this week" clubs shown above it; the count still covers them', () => {
    expect(src).toContain('? exploreBase.filter(c => !activeThisWeek.some(a => a.id === c.id))')
    expect(src).toContain("const shownCount   = tab === 'mine' ? myClubs.length : exploreBase.length")
    expect(src).toContain("['explore', 'Explore', notMine.length]")
  })
})
