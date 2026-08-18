import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DISCOVER_LINKS } from '@/lib/navLinks'

// A route should have ONE name. /posts had five: "Stories" in the nav,
// "Articles 📰" in the footer, "📰 Community Articles" on its own eyebrow,
// "Stories & Guides" in its h1, and "Articles & Stories" in its title and
// share cards. Two of them promised guides the page doesn't have — guides live
// at /guide and /handbook — so the name collided with two other surfaces while
// describing none of them.
//
// Nothing caught it because each surface names routes independently: the nav
// from lib/navLinks, the footer inline in its own JSX. This compares them.

const footer = readFileSync(join(process.cwd(), 'components/Footer.tsx'), 'utf8')
const posts  = readFileSync(join(process.cwd(), 'app/posts/page.tsx'), 'utf8')

// Footer links are object literals: { href: '/posts', label: 'Stories 📰' }
const footerLinks = new Map<string, string>()
for (const m of footer.matchAll(/\{\s*href:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'\s*\}/g)) {
  // Labels carry a trailing emoji and a decorative '?'; compare the words.
  footerLinks.set(m[1], m[2].replace(/[^\p{L}\s]/gu, '').trim())
}

describe('a route has one name', () => {
  it('finds the footer links to compare (guards against a regex that quietly matches nothing)', () => {
    expect(footerLinks.size).toBeGreaterThan(3)
    expect(footerLinks.has('/posts')).toBe(true)
  })

  // A footer entry may phrase itself as an invitation — "Meet the hosts" for
  // Hosts — and that is one name, worded twice. What this catches is a route
  // called two DIFFERENT things, which is how /posts ended up as both
  // "Articles" and "Stories" with nobody noticing.
  //
  // Empty on purpose. /members was the one entry here — Discover called it
  // "People", the footer "Members", for the same page — and it was settled
  // rather than allowlisted. Adding a route back into this set should mean a
  // deliberate decision that two names are right, not a way past the test.
  const KNOWN_DIFFERENT = new Set<string>()

  it('footer and Discover never call the same route two different things', () => {
    const contradictions: string[] = []
    for (const link of DISCOVER_LINKS) {
      const inFooter = footerLinks.get(link.href)
      if (!inFooter || KNOWN_DIFFERENT.has(link.href)) continue
      const a = inFooter.toLowerCase()
      const b = link.label.toLowerCase()
      if (!a.includes(b) && !b.includes(a)) {
        contradictions.push(`${link.href}: nav "${link.label}" vs footer "${inFooter}"`)
      }
    }
    expect(contradictions).toEqual([])
  })

  it('/posts calls itself Stories on its own page, not Articles or Guides', () => {
    // Comments explain the history and are allowed to name the old variants.
    const code = posts.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code).not.toMatch(/Stories &amp; Guides|Stories & Guides/)
    expect(code).not.toMatch(/Articles & Stories/)
    expect(code).not.toMatch(/Community Articles/)
    expect(code).toMatch(/Stories — Smileys Community/)
  })
})
