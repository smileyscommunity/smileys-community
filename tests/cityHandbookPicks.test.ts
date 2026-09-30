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

  it.each(HUBS)('%s shows the same shelf, read for its own city', hub => {
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

describe('/visiting Handbook essentials', () => {
  const visiting = read('app/visiting/page.tsx')

  it('each row picks the article about its topic, with the category pick as fallback', () => {
    // The newest-in-category rule put SIM on the e-Devlet guide, Money on the
    // tax-number guide and Istanbul's transport on the airport guide.
    expect(visiting).toContain("pickArticle(handbook, 'Mobile & Digital', /\\bsim\\b|esim|internet/i, cityId) ?? essential('Mobile & Digital')")
    expect(visiting).toContain("pickArticle(handbook, 'Getting Around', /kart|card|getting.around|dolmu/i, cityId) ?? essential('Getting Around')")
    expect(visiting).toContain("pickArticle(handbook, 'Money & Banking', /bank/i, cityId) ?? essential('Money & Banking')")
    expect(visiting).toContain("pickArticle(handbook, 'Safety & Emergencies', /emergenc|\\b112\\b/i, cityId) ?? essential('Safety & Emergencies')")
  })

  it('the patterns land on the right real articles and skip the wrong ones', () => {
    const transport = /kart|card|getting.around|dolmu/i
    for (const t of ['Istanbulkart Mastery: The only ticket that matters', 'Antalyakart: One Card for the Bus and the Tram',
                     'Getting Around Bodrum: Dolmuş, Ferries, Taxis & the Airport', 'İzmirim Kart: The Only Ticket That Matters'])
      expect(transport.test(t)).toBe(true)
    expect(transport.test('Arriving in Istanbul: Getting from IST and Sabiha Gökçen into the City arriving-in-istanbul')).toBe(false)
    expect(/\bsim\b|esim|internet/i.test('e-Devlet for Foreigners: Getting Your Password e-devlet-for-foreigners')).toBe(false)
    expect(/\bsim\b|esim|internet/i.test('Getting a SIM Card and Home Internet in Türkiye')).toBe(true)
    expect(/bank/i.test('Getting a Turkish Tax Number as a Foreigner')).toBe(false)
  })

  it('the essentials list skips articles the Start-here cards already show', () => {
    expect(visiting).toContain('const listedEssentials = essentials.filter(x => !pickedSlugs.has(x.article!.slug))')
    expect(visiting).toContain('{listedEssentials.map(x => (')
  })
})
