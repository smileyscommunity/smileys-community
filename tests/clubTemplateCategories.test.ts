import { describe, it, expect } from 'vitest'
import { CLUB_TEMPLATES } from '@/lib/clubTemplates'
import { CLUB_CATEGORIES } from '@/lib/data'

// Every city launch stamps one club per template, so a template category that
// is not in CLUB_CATEGORIES lands in every new city at once: no /clubs filter
// shows the club and the admin form cannot save it. On 2026-10-12 four did
// ('Food & Dining', 'Outdoors', 'Music', 'Newcomers'), across 35 clubs.
describe('CLUB_TEMPLATES', () => {
  it('only uses real club categories', () => {
    const known = new Set<string>(CLUB_CATEGORIES)
    const unknown = CLUB_TEMPLATES
      .filter(t => !known.has(t.category))
      .map(t => `${t.key}: ${t.category}`)
    expect(unknown).toEqual([])
  })
})
