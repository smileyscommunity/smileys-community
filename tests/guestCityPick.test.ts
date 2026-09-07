import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// "If you are not logged in and pick Bodrum, visiting is Istanbul — for
// every city it's Istanbul" (2026-09-08). A guest's pick in the cities menu
// was a plain link to the city's page; nothing set the view-city cookie, so
// the next bare link resolved to the default city. Guests now enter through
// the cookie-setting route, the visiting page pins its city in the URL like
// every other city-scoped page, and the links into it carry the city.
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

describe('a guest picking a city', () => {
  it('goes through the cookie-setting entry route, not a plain link', () => {
    const menu = read('components/CitiesMenu.tsx')
    expect(menu).toMatch(/href=\{`\/app\/api\/city\/enter\?city=\$\{c\.slug\}&to=city`\}/)
    // Coming-soon rows still link to the city page: nothing to scope to yet.
    expect(menu).toMatch(/soon\.map\(c => \([\s\S]*?href=\{`\/\$\{c\.slug\}`\}/)
  })

  it('the entry route knows visiting as a destination', () => {
    expect(read('app/api/city/enter/route.ts')).toMatch(/visiting:\s+'\/visiting'/)
    expect(read('app/[city]/data.ts')).toMatch(/\| 'visiting'/)
  })

  it('the visiting page pins a non-default city in its URL and canonical', () => {
    const page = read('app/visiting/page.tsx')
    expect(page).toMatch(/if \(!pinned && city\.slug !== DEFAULT_CITY_SLUG\) \{/)
    expect(page).toMatch(/redirect\(`\/visiting\?\$\{qs\}`\)/)
    expect(page).toMatch(/city\.slug === DEFAULT_CITY_SLUG \? `\$\{APP_URL\}\/visiting` : `\$\{APP_URL\}\/visiting\?city=\$\{city\.slug\}`/)
  })

  it('the guide and neighborhoods pages link to visiting with the city they show', () => {
    for (const f of ['app/guide/page.tsx', 'app/neighborhoods/page.tsx']) {
      expect(read(f)).toMatch(/city\.slug === DEFAULT_CITY_SLUG \? '\/visiting' : `\/visiting\?city=\$\{city\.slug\}`/)
    }
  })
})
