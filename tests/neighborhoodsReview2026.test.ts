import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// 2026-09-23 review of /neighborhoods — the index, the 100+ detail pages, the
// wall behind them and the admin panel that edits the registry. The findings
// that mattered were about who gets seen and which city's page a link means:
// the index handed guests full names and photographs, four slugs are shared by
// two cities each and always resolved to Istanbul, and the wall kept banned
// authors and ignored blocks.

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('the wall shows live authors only, and shows them the way every other surface does', () => {
  const posts   = read('app/api/neighborhoods/[slug]/posts/route.ts')
  const replies = read('app/api/neighborhoods/[slug]/posts/[postId]/replies/route.ts')

  it('filters banned/hidden authors and blocked pairs out of posts and replies', () => {
    for (const src of [posts, replies]) {
      expect(src).toContain('user: LIVE_BOARD_AUTHOR')
      expect(src).toContain('blockedIdsFor')
      expect(src).toContain('{ userId: { notIn: [...blocked] } }')
    }
  })

  it('projects the author rather than handing the row out raw', () => {
    // buildAuthor never read profileVisibility, so a connections-only member
    // was shown in full on the wall while every other surface gave a stranger
    // a first name and no photo.
    for (const src of [posts, replies]) {
      expect(src).toContain("from '@/lib/wallAuthor'")
      expect(src).toContain('profileVisibility: true')
      // buildAuthor survives on the POST response alone — the writer's own
      // row, never restricted from themselves.
      expect(src).toMatch(/author:\s+show\(/)
    }
  })

  it('rate-limits the read, not just the writes', () => {
    expect(posts).toContain('nh-wall-read:')
  })

  it('a write lands in a city the member actually joined', () => {
    expect(posts).toContain('resolvePostingCityId')
  })
})

describe('the wall under a page is that page\'s wall', () => {
  const api  = read('app/api/neighborhoods/[slug]/posts/route.ts')
  const wall = read('components/NeighborhoodWall.tsx')
  const secs = read('app/neighborhoods/[slug]/NeighborhoodSections.tsx')

  it('the client asks for the city the page resolved to', () => {
    expect(secs).toContain('citySlug={city.slug}')
    expect(wall).toContain('const wallUrl = `/app/api/neighborhoods/${slug}/posts?city=${encodeURIComponent(citySlug)}`')
    // Both the list and the create go through that one URL.
    expect(wall).not.toContain('`/app/api/neighborhoods/${slug}/posts`')
  })

  it('and the API resolves from it, the way the page does', () => {
    // Without this, Ankara's Ulus page carried Istanbul's wall and a post
    // written there was filed to Istanbul's Ulus — the cross-city write the
    // 403 above was added to prevent, walked straight past.
    expect(api).toContain("req.nextUrl.searchParams.get('city')")
    expect(api).toContain('resolveNeighborhoodBySlug(slug, pinned?.id ?? await resolveCityId(session))')
  })

  it('a mention notification links to the post\'s own city', () => {
    expect(api).toContain('wallCity.slug === DEFAULT_CITY_SLUG')
  })

  it('counts the replies it will actually show', () => {
    // "Show all 3 replies" opened an empty list for ever when the only reply
    // was by a banned or blocked author.
    expect(api).toContain('_count: { select: { replies: { where: { user: LIVE_BOARD_AUTHOR,')
  })
})

describe('a reply is deleted through the post it belongs to', () => {
  const src = read('app/api/neighborhoods/[slug]/posts/[postId]/replies/[replyId]/route.ts')
  it('checks the reply against the postId in the URL', () => {
    expect(src).toContain('const { postId, replyId } = await params')
    expect(src).toContain('reply.postId !== postId')
  })
})

describe('a slug two cities share resolves to the city the link meant', () => {
  const page    = read('app/neighborhoods/[slug]/page.tsx')
  const index   = read('app/neighborhoods/page.tsx')
  const grid    = read('components/NeighborhoodGrid.tsx')
  const mapView = read('components/NeighborhoodsMapView.tsx')
  const sitemap = read('app/sitemap.ts')

  it('the detail page reads ?city= before the session, in both the page and its metadata', () => {
    expect(page.match(/resolveCityForPage\(searchParams\)/g)).toHaveLength(2)
    expect(page).not.toContain('await resolveCityId(await getSession())')
  })

  it('and canonicalises to the qualified URL for every city but the default', () => {
    // One `url`, used by the canonical, og:url and the JSON-LD alike — they
    // used to disagree, the canonical naming Ankara and the rest Istanbul.
    expect(page).toContain("const url = `${APP_URL}/neighborhoods/${slug}${city.slug === DEFAULT_CITY_SLUG ? '' : `?city=${city.slug}`}`")
    expect(page).toContain('alternates: { canonical: url }')
  })

  it('the index emits city-qualified links — cards, map popups, JSON-LD and deep links', () => {
    expect(index).toContain("const cityQuery = city.slug === DEFAULT_CITY_SLUG ? '' : `?city=${city.slug}`")
    expect(index).toContain('citySlug={city.slug === DEFAULT_CITY_SLUG ? null : city.slug}')
    expect(index).toContain('`${APP_URL}/neighborhoods/${n.slug}${cityQuery}`')
    // The side cards use a relative query, which replaces the whole string.
    expect(index).toContain("`?${cityQuery ? `city=${city.slug}&` : ''}side=")
    expect(grid).toContain("const cityQuery = citySlug ? `?city=${citySlug}` : ''")
    expect(grid).toContain('href={`/neighborhoods/${n.slug}${cityQuery}`}')
    expect(mapView).toContain('link.href = `/app/neighborhoods/${p.slug}${cityQuery}`')
  })

  it('the detail page keeps the city on its own links and on every URL in its head', () => {
    const secs = read('app/neighborhoods/[slug]/NeighborhoodSections.tsx')
    expect(page).toContain("const url = `${APP_URL}/neighborhoods/${slug}${city.slug === DEFAULT_CITY_SLUG ? '' : `?city=${city.slug}`}`")
    expect(page).toContain('alternates: { canonical: url }')
    expect(page).toContain('const pageUrl = `${APP_URL}/neighborhoods/${slug}${cityQuery}`')
    expect(page).toContain('href={`/neighborhoods/${n.slug}${cityQuery}`}')
    // The nearby / also-like rails, which listed this city's neighborhoods and
    // linked to the default city's pages.
    expect(secs.match(/href=\{`\/neighborhoods\/\$\{n\.slug\}\$\{cityQuery\}`\}/g)).toHaveLength(2)
  })

  it('"your neighborhood" is only yours in your own city', () => {
    expect(read('app/neighborhoods/page.tsx')).toContain('session?.cityId === cityId ? session?.neighborhood ?? null : null')
    expect(page).toContain("session?.neighborhood === name && session?.cityId === cityId")
  })

  it('the sitemap lists both cities rather than deduping one away', () => {
    // Deduping by slug silently dropped four pages: Ankara's Ulus,
    // Bahçelievler and Gaziosmanpaşa, and İzmir's Göztepe.
    expect(sitemap).not.toContain('new Map(hoods.map(n => [n.slug, n]))')
    expect(sitemap).toContain('citySlugById')
    expect(sitemap).toContain('`${BASE}/neighborhoods/${n.slug}?city=${citySlug}`')
  })

  it('and does not lend one city\'s editorial mtime to another\'s page', () => {
    expect(sitemap).toContain('(citySlug === DEFAULT_CITY_SLUG ? neighborhoodMtimes.get(n.slug) : undefined) ?? n.updatedAt')
  })
})

describe('the page tells the truth about what it counts', () => {
  const index = read('app/neighborhoods/page.tsx')
  const hero  = read('app/neighborhoods/[slug]/HeroStats.tsx')

  it('"Hot right now" needs something on the calendar, not just residents', () => {
    expect(index).toContain("if (eventCount > 0 && score >= 9) return { label: 'Hot right now'")
    expect(index).toContain("if (eventCount > 0 && score >= 5) return { label: 'Active'")
    // The old bottom label claimed a month it never measured.
    expect(index).not.toContain('Quiet this month')
  })

  it('the next event per neighborhood is one row per neighborhood, decided by Postgres', () => {
    // Prisma's `distinct` is applied client-side, so it would have replaced a
    // 300-row cap with an unbounded read. DISTINCT ON is the database doing it.
    expect(index).toContain('SELECT DISTINCT ON ("neighborhood")')
    expect(index).not.toContain("distinct: ['neighborhood']")
    expect(index).not.toContain('take: 300')
  })

  it('"you are among N locals" does not count the viewer as their own company', () => {
    expect(hero).toContain('const otherLocals = Math.max(0, totalLocals - (viewerCounted > 0 ? 1 : 0))')
    expect(hero).toContain("You're the first local Smileys member here")
  })

  it('"Host an event here" is offered only to someone who belongs to this city', () => {
    // Gated on membership (home or joined), not on which city their club is
    // in: a member who joined Ankara may host there with an Istanbul club.
    expect(hero).toContain('getMemberCityIds(userId).then(ids => ids.includes(cityId))')
    expect(hero).toContain('{approvedHost && belongsHere && (')
  })
})

describe('members named on a neighborhood page are named by the shared rules', () => {
  const sections = read('app/neighborhoods/[slug]/NeighborhoodSections.tsx')

  it('hangout hosts go through the same projector as everyone else', () => {
    expect(sections).toContain('const showHangoutHost = await authorProjector(viewer, activeHangouts.map(h => h.user))')
    expect(sections).toContain('const host   = showHangoutHost(h.user)')
    expect(sections).not.toMatch(/\{h\.user\.name\}/)
  })

  it('hangout and pulse times render in the city, not server UTC', () => {
    // A 21:00 Istanbul hangout read "Starts 18:00" on a UTC server.
    expect(sections.match(/timeZone: city\.timezone/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(sections).not.toContain('hour12: false')
  })

  it('but a visiting range is a pair of calendar days — parsed and rendered as UTC', () => {
    // city.timezone on a date-only value shifts it a day for any city west of
    // the server. These are days, not instants.
    expect(sections).toContain("new Date(v.startsOn + 'T00:00:00Z')")
    expect(sections).toContain('s.getUTCMonth() === e.getUTCMonth()')
  })
})

describe('maps', () => {
  it('a search with no letters in it is not a search', () => {
    expect(read('components/NeighborhoodGrid.tsx')).toContain('const filtered      = q && qf')
  })

  it('a neighborhood with no coordinates is left off the map instead of plotted at 0,0', () => {
    expect(read('components/NeighborhoodGrid.tsx')).toContain('n.meta.lat != null && n.meta.lon != null')
    expect(read('app/neighborhoods/[slug]/page.tsx')).toContain('meta.lat != null && meta.lon != null &&')
    expect(read('lib/directoryMapPosition.ts')).toContain('meta.lat != null && meta.lon != null')
  })

  it('marker images are served from here, not from a third-party CDN', () => {
    for (const p of ['components/NeighborhoodMap.tsx', 'components/NeighborhoodsMapView.tsx', 'components/DirectoryMap.tsx']) {
      const src = read(p)
      expect(src).not.toContain('unpkg.com')
      expect(src).toContain('/app/leaflet/marker-icon.png')
    }
  })
})

describe('admin copy matches what hiding a neighborhood actually does', () => {
  it('says the page stops loading instead of promising it stays readable', () => {
    const src = read('app/admin/neighborhoods/page.tsx')
    // active:false makes every lookup miss (lib/neighborhoodsDb), so the page
    // 404s and its wall goes with it.
    expect(src).not.toContain('disappears from pickers and pages; tagged content stays readable')
    expect(src).toContain('its neighborhood page stops loading')
  })
})
