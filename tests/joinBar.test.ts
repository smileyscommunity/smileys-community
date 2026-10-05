import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { joinBarAllowed } from '@/lib/joinBar'

const read = (p: string) => readFileSync(p, 'utf-8')

describe('where the mobile Join bar may appear', () => {
  it('shows on long public content pages', () => {
    for (const p of ['/', '/istanbul', '/handbook/residence-permit', '/posts/some-story', '/neighborhoods/kadikoy',
      '/events', '/istanbul/events', '/istanbul/events/this-weekend', '/events/today', '/about', '/why', '/guide'])
      expect(joinBarAllowed(p), p).toBe(true)
  })

  it('hides where joining is irrelevant or the page has its own sticky action', () => {
    for (const p of ['/apply', '/apply/confirmed', '/login', '/forgot-password', '/reset-password', '/activate',
      '/contact', '/privacy', '/terms', '/cookies', '/guidelines', '/admin', '/admin/events', '/host/events',
      '/visiting', '/visiting/new', '/events/ckx123abc', '/pending'])
      expect(joinBarAllowed(p), p).toBe(false)
  })

  it('tolerates a trailing slash', () => {
    expect(joinBarAllowed('/apply/')).toBe(false)
    expect(joinBarAllowed('/handbook/')).toBe(true)
  })
})

describe('the sticky bar component', () => {
  const c = read('components/JoinStickyBar.tsx')
  it('is guests-only, phones-only, above the safe-area inset, with a real touch target and a dismiss', () => {
    expect(c).toMatch(/!isLoading && !isLoggedIn && joinBarAllowed\(pathname\)/)
    expect(c).toMatch(/md:hidden fixed bottom-0/)
    expect(c).toMatch(/pb-\[env\(safe-area-inset-bottom\)\]/)
    expect(c).toMatch(/min-h-\[44px\]/)
    expect(c).toMatch(/w-11 h-11/)
    expect(c).toMatch(/aria-label="Dismiss"/)
  })
  it('waits for the hero CTA to leave the TOP of the screen, else a scroll depth, and for the cookie answer', () => {
    expect(c).toMatch(/querySelector\('\[data-join-hero\]'\)/)
    expect(c).toMatch(/!e\.isIntersecting && e\.boundingClientRect\.bottom < 0/)
    expect(c).toMatch(/JOIN_BAR_SCROLL_FALLBACK_PX/)
    expect(c).toMatch(/const show = eligible && pastHero && answered/)
    expect(read('components/CookieBanner.tsx').match(/dispatchEvent\(new Event\('smileys:consent'\)\)/g)?.length).toBe(2)
  })
  it('is measurable: tagged for the join tracker, plus shown and dismissed events', () => {
    expect(c).toMatch(/data-cta="sticky-bar"/)
    expect(c).toMatch(/track\('join_bar_shown'/)
    expect(c).toMatch(/track\('join_bar_dismissed'/)
  })
  it('is mounted site-wide and the hero CTAs are marked', () => {
    expect(read('components/ClientOnlyComponents.tsx')).toMatch(/<JoinStickyBar \/>/)
    expect(read('app/page.tsx')).toMatch(/href="\/apply" data-join-hero/)
    expect(read('app/[city]/sections/Hero.tsx')).toMatch(/data-join-hero data-join-city=\{city\.slug\}/)
  })
  it('keeps room for itself above the footer on phones', () => {
    expect(read('app/globals.css')).toMatch(/html\.has-join-bar body \{ padding-bottom: calc\(64px \+ env\(safe-area-inset-bottom/)
  })
})
