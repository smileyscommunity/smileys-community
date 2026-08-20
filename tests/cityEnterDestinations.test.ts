import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Every feed header's "✕ Back to <home city>" link hits
// /api/city/enter?clear=1&to=<key>. The destination map is deliberately closed
// — a redirect target is never caller-shaped — and an unknown key silently
// falls back to /events. So adding the escape hatch to a new feed without
// adding its key sends members to the wrong page, and nothing errors.
//
// That is exactly what happened when the hatch reached /members: the link
// shipped as to=members while the map had no such key.

const ROUTE = readFileSync(join(process.cwd(), 'app/api/city/enter/route.ts'), 'utf8')
const MAP = ROUTE.split('const DESTINATIONS')[1]?.split('}')[0] ?? ''

/** Every `to=` key any page actually links to. */
function linkedKeys(): string[] {
  const keys = new Set<string>()
  const files = ['app/events/page.tsx', 'app/clubs/page.tsx', 'app/directory/page.tsx', 'app/(member)/members/page.tsx']
  for (const f of files) {
    let src = ''
    try { src = readFileSync(join(process.cwd(), f), 'utf8') } catch { continue }
    for (const m of src.matchAll(/city\/enter\?[^"']*\bto=([a-z]+)/g)) keys.add(m[1])
  }
  return [...keys]
}

describe('city/enter destinations', () => {
  it('knows the keys the feeds link to', () => {
    expect(linkedKeys().length).toBeGreaterThan(2)
  })

  it('has a destination for every key a feed links to', () => {
    const missing = linkedKeys().filter(k => !MAP.includes(`${k}:`))
    expect(missing, 'these would silently redirect to /events instead').toEqual([])
  })

  it('includes members, the one that was missing', () => {
    expect(MAP).toContain('members:')
  })

  it('still refuses a caller-shaped target — the map is the allowlist', () => {
    // The fallback is a fixed path, not anything derived from the query.
    expect(ROUTE).toMatch(/DESTINATIONS\[toKey\] \?\? '\/events'/)
  })
})
