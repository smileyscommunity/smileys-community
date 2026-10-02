import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The city page's "Start here" shelf (lib/cityHandbookPicks + the Guide
// section). Source pins: the rules that keep it honest live in the query and
// the markup, not in anything a unit test could call without a database.
const lib   = readFileSync(join(__dirname, '../lib/cityHandbookPicks.ts'), 'utf8')
// Code only — the comments explain what the shelf deliberately doesn't do.
const code  = lib.replace(/^\s*\/\/.*$/gm, '')
const shelf = readFileSync(join(__dirname, '../components/HandbookPicks.tsx'), 'utf8')
const guide = readFileSync(join(__dirname, '../app/[city]/sections/Guide.tsx'), 'utf8')
const page  = readFileSync(join(__dirname, '../app/[city]/page.tsx'), 'utf8')
const read  = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
// The four arrival hubs show the same shelf in their Handbook section.
const HUBS = ['app/[city]/moving/page.tsx', 'app/[city]/remote-work/page.tsx', 'app/[city]/students/page.tsx', 'app/visiting/page.tsx']
// /visiting dropped the shelf (Nate, 2026-10-02): the city's most-read
// articles are renting and family life — moving-here reading, not a trip's.
const SHELF_HUBS = HUBS.filter(h => h !== 'app/visiting/page.tsx')

describe('city page Handbook shelf', () => {
  it("reads only this city's own published Handbook articles, most read first, three at most", () => {
    expect(lib).toContain("where:   { kind: 'handbook', status: 'published', cityId },")
    expect(lib).toContain("orderBy: [{ views: 'desc' }, { publishedAt: 'desc' }],")
    expect(lib).toContain('take:    3,')
    // Not the national scope — those fill the Handbook index already.
    expect(code).not.toContain('postCityScope')
  })

  it('returns only what a card renders (the body is read for the cover, then dropped)', () => {
    expect(lib).toMatch(/return rows\.map\(r => \(\{\s*slug:\s*r\.slug,\s*title:\s*r\.title,\s*excerpt: r\.excerpt,\s*cover:\s*articleCover/)
    // body appears only inside the articleCover call, never as a returned key
    expect(code.match(/r\.body/g)).toHaveLength(1)
  })

  it('never falls back to a category banner for the cover (text graphics, not photos)', () => {
    expect(lib).toContain('articleCover({ coverImage: r.coverImage, body: r.body })')
    expect(code).not.toContain('category')
  })

  it('is cached per city and busted with the rest of the Handbook', () => {
    expect(lib).toContain("async (cityId: string) =>")
    expect(lib).toContain("{ revalidate: 300, tags: ['handbook'] }")
  })

  it('links keep the city and the shelf hides when a city has none', () => {
    expect(shelf).toContain('href={`/handbook/${p.slug}${cityQs(citySlug)}`}')
    expect(shelf).toContain('if (picks.length === 0) return null')
    // Both branches of the city page's Guide section (with and without a guide) render it.
    expect(guide.match(/<HandbookPicks citySlug=\{city\.slug\} picks=\{handbookPicks\}/g)).toHaveLength(2)
    expect(page).toContain('getCityHandbookPicks(city.id),')
    expect(page).toContain('handbookPicks={handbookPicks}')
  })

  it.each(SHELF_HUBS)('%s shows the same shelf, read for its own city', hub => {
    const src = read(hub)
    expect(src).toMatch(/getCityHandbookPicks\((city\.id|cityId)\),/)
    expect(src.match(/<HandbookPicks citySlug=\{city\.slug\} picks=\{handbookPicks\}/g)).toHaveLength(1)
  })

  it.each(HUBS)('%s: every article link keeps the city', hub => {
    // An article opened from /antalya/moving without ?city= showed Istanbul's
    // breadcrumbs and related articles. cityQs is '' for the default city.
    const src = read(hub)
    const links = src.match(/`\/handbook\/\$\{[^`]*?\.slug\}[^`]*`/g) ?? []
    expect(links.length).toBeGreaterThan(0)
    for (const l of links) expect(l).toContain('${handbookQs(city.slug)}')
  })
})

describe('/visiting visitor essentials', () => {
  const visiting = read('app/visiting/page.tsx')
  // The page's own patterns, read out of the source so the test checks what ships.
  const pattern = (key: string) => {
    const m = visiting.match(new RegExp(`key: '${key}',[^\\n]*?about: (/[^\\n]*?/[a-z]*),`))
    if (!m) throw new Error(`no row ${key}`)
    const body = m[1].slice(1, m[1].lastIndexOf('/')), flags = m[1].slice(m[1].lastIndexOf('/') + 1)
    return new RegExp(body, flags)
  }

  it('is a visitor\'s list: no Start-here shelf, no bank-account row', () => {
    expect(visiting).not.toContain('<HandbookPicks')
    expect(visiting).not.toContain('getCityHandbookPicks')
    expect(visiting).not.toMatch(/key: 'money'/)
    for (const k of ['entry', 'airport', 'connect', 'transport', 'scams', 'emergency']) expect(visiting).toContain(`key: '${k}'`)
  })

  it('each row picks the article about its topic; one article answers one row', () => {
    expect(visiting).toContain('pickArticle(pool, r.category, r.about, cityId) ?? (r.fallback ? essentialIn(pool, r.category) : null)')
    expect(visiting).toContain('usedSlugs.add(article.slug)')
    // The airport row is asked before transport, so the transport pattern can't claim the airport guide.
    expect(visiting.indexOf("key: 'airport'")).toBeLessThan(visiting.indexOf("key: 'transport'"))
  })

  it('the patterns land on the right real articles and skip the wrong ones', () => {
    const transport = pattern('transport'), airport = pattern('airport'), sim = pattern('connect'), scams = pattern('scams')
    for (const t of ['Istanbulkart Mastery: The only ticket that matters', 'Antalyakart: One Card for the Bus and the Tram',
                     'Getting Around Bodrum: Dolmuş, Ferries, Taxis & the Airport', 'İzmirim Kart: The Only Ticket That Matters'])
      expect(transport.test(t), t).toBe(true)
    expect(transport.test('Arriving in Istanbul: Getting from IST and Sabiha Gökçen into the City arriving-in-istanbul')).toBe(false)
    expect(airport.test('Arriving in Istanbul: Getting from IST and Sabiha Gökçen into the City')).toBe(true)
    // Bodrum's transport guide mentions the airport; it must stay Bodrum's "Getting around".
    expect(airport.test('Getting Around Bodrum: Dolmuş, Ferries, Taxis & the Airport')).toBe(false)
    expect(sim.test('e-Devlet for Foreigners: Getting Your Password e-devlet-for-foreigners')).toBe(false)
    expect(sim.test('Getting a SIM Card and Home Internet in Türkiye')).toBe(true)
    expect(scams.test('Scams & Tourist Traps in Türkiye: How to stay safe without becoming paranoid')).toBe(true)
  })

  it('what a first event is like sits with the events, not in the first 48 hours', () => {
    const plan = visiting.indexOf('<section id="plan"'), first48 = visiting.indexOf('<section id="first-48"')
    const explainer = visiting.indexOf('What a first Smileys event is like')
    expect(explainer).toBeGreaterThan(plan)
    expect(visiting.slice(first48, visiting.indexOf('</section>', first48))).not.toContain('What a first Smileys event is like')
  })
})

describe('/visiting featured essentials', () => {
  const visiting = read('app/visiting/page.tsx')
  it('the first three get a cover card; covers are read for those slugs only, with no banner fallback', () => {
    expect(visiting).toContain('const FEATURED_ESSENTIALS = 3')
    expect(visiting).toContain('getEssentialCovers(featuredEssentials.map(x => x.article.slug))')
    const fn = visiting.slice(visiting.indexOf('const getEssentialCovers'), visiting.indexOf("['visiting-essential-covers']"))
    expect(fn).toContain('where:  { slug: { in: slugs }')
    // articleCover falls back to the category banner only when given a category — never here.
    expect(fn).toContain('articleCover({ coverImage: r.coverImage, body: r.body })')
    expect(fn).not.toMatch(/category/)
  })
})
