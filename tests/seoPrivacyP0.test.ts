import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { guestEventDescription } from '@/lib/db'

// 2026-10-02 SEO/privacy pass. Routes open a DB connection at import, so the
// rules are pinned against the source (the publicPageGuestPrivacy approach).

describe('members-only events withhold the venue and description from guests', () => {
  it('discovery feed: the guest branch maps location to the neighbourhood', () => {
    const src = readFileSync('app/api/events/discovery/route.ts', 'utf-8')
    expect(src).toMatch(/membersOnly: true/)
    expect(src).toMatch(/soon: shapeGroups\(soon, true\)/)
    expect(src).toMatch(/weekend: shapeGroups\(weekend, true\)/)
    expect(src).toMatch(/guest && e\.membersOnly \? \(e\.neighborhood/)
  })

  it('public watch-parties endpoint skips members-only events', () => {
    expect(readFileSync('app/api/cup/watch-parties/route.ts', 'utf-8')).toMatch(/membersOnly: false/)
  })

  it('guestEventDescription hides a members-only body and keeps a public one', () => {
    const base = { title: 'Home dinner', neighborhood: 'Kadıköy' }
    const hidden = guestEventDescription({ ...base, membersOnly: true, description: 'Call 0555 123 4567, flat 4' })
    expect(hidden).not.toContain('0555')
    expect(hidden).toContain('Kadıköy')
    expect(guestEventDescription({ ...base, membersOnly: false, description: 'Open to all' })).toBe('Open to all')
  })

  it('the event page uses it for the page body, calendar button and metadata', () => {
    const page = readFileSync('app/events/[id]/page.tsx', 'utf-8')
    expect(page).toMatch(/const publicDescription = guestEventDescription\(event\)/)
    expect(page).toMatch(/sanitize\(publicDescription\)/)
    expect(page).toMatch(/const guestDesc\s+= guestEventDescription\(event\)/)
    expect(page).not.toMatch(/sanitize\(event\.description\)/)
  })
})

describe('indexing rules', () => {
  const robots = readFileSync('public/robots.txt', 'utf-8')
  it('robots.txt lets crawlers fetch event/club/directory covers but never member photos', () => {
    for (const f of ['events', 'clubs', 'directory']) expect(robots).toContain(`Allow: /app/api/files/${f}/`)
    for (const f of ['users', 'hangouts', 'messages', 'applications']) expect(robots).not.toContain(`Allow: /app/api/files/${f}/`)
    expect(robots).toContain('Disallow: /app/api/')
  })

  it('utility and account paths carry an X-Robots-Tag noindex', () => {
    const cfg = readFileSync('next.config.js', 'utf-8')
    expect(cfg).toMatch(/NOINDEX_PATHS = \[[^\]]*'dashboard'[^\]]*'messages'[^\]]*'admin'[^\]]*'login'/s)
    expect(cfg).toMatch(/X-Robots-Tag', value: 'noindex, nofollow'/)
  })

  it('legal pages declare a canonical', () => {
    for (const p of ['privacy', 'terms', 'cookies', 'guidelines'])
      expect(readFileSync(`app/${p}/page.tsx`, 'utf-8')).toContain(`canonical: 'https://smileyscommunity.com/app/${p}'`)
  })

  it('stories carry BlogPosting JSON-LD, escaped, and not on a preview', () => {
    const page = readFileSync('app/posts/[slug]/page.tsx', 'utf-8')
    expect(page).toMatch(/'@type':\s+'BlogPosting'/)
    expect(page).toMatch(/const blogPostingJsonLd = preview \? null/)
    expect(page).toMatch(/jsonLdHtml\(blogPostingJsonLd\)/)
  })
})

describe('sitemap event policy', () => {
  const src = readFileSync('app/sitemap.ts', 'utf-8')
  it('lists upcoming events and worthwhile recent past ones, never members-only, no 200 cap', () => {
    expect(src).toMatch(/membersOnly: false,\s*OR: \[\s*\{ date: \{ gte: sitemapToday \} \},\s*\{ date: \{ gte: pastCutoff \}, coverImage: \{ not: '' \}, description: \{ not: '' \} \}/)
    expect(src).not.toMatch(/take: 200,\s*\}\),\s*prisma\.club/)
  })
  it('lists the this-week/this-weekend/today pages only when they have events', () => {
    expect(src).toMatch(/inWindow\(mine, w, today\)\.length > 0/)
    expect(src).toContain('...eventWindowRoutes')
  })
})
