import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-09-22. An admin searching for a member who plainly exists got
// "No users found." The API was innocent — it returned her. The page threw
// her away again on arrival.
//
// Two layers filter the same search box: the request sends
// searchRef.current.trim(), and the returned rows are then re-filtered
// client-side by `search` — untrimmed. One trailing space, which is what
// pasting a name out of a message or an email gives you, and the two
// disagree: the server matches "anna popova", the client then asks whether
// "anna popova".includes("anna popova ") and drops every row the server
// just found. The search box looked broken for any term with an edge space.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

// The client-side predicate, as the page applies it to each returned row.
const clientKeeps = (name: string, email: string, term: string) => {
  const s = term.trim().toLowerCase()
  return !s || name.toLowerCase().includes(s) || email.toLowerCase().includes(s)
}

describe('admin user search treats the two filter layers as one', () => {
  const ANNA = { name: 'Anna Popova', email: 'anna.popova@example.com' }

  it('finds a member whose search term carries an edge space', () => {
    for (const term of ['anna popova', 'anna popova ', ' anna popova', '  Anna Popova  ', 'popova ']) {
      expect(clientKeeps(ANNA.name, ANNA.email, term)).toBe(true)
    }
  })

  it('still narrows on a term that genuinely does not match', () => {
    expect(clientKeeps(ANNA.name, ANNA.email, 'smirnova')).toBe(false)
    expect(clientKeeps(ANNA.name, ANNA.email, 'zzz ')).toBe(false)
  })

  it('an all-whitespace term filters nothing, rather than matching nothing', () => {
    // Untrimmed, "   " matched only names containing three spaces — i.e.
    // nobody — so a stray space bar emptied the table.
    expect(clientKeeps(ANNA.name, ANNA.email, '   ')).toBe(true)
  })

  it('the page filters by the same trimmed term it sent to the server', () => {
    const page = src('app/admin/users/page.tsx')
    expect(page).toContain("params.set('search', searchRef.current.trim())")
    // The client filter must trim too, or it discards what the server found.
    expect(page).toContain('const s = search.trim().toLowerCase()')
  })

  it('the API trims what it is handed, so a direct call behaves the same', () => {
    const api = src('app/api/admin/users/route.ts')
    expect(api).toContain("const search = (params.get('search') ?? '').trim()")
  })
})
