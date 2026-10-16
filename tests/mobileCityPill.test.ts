import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

describe('mobile header city pill', () => {
  it('the phone header carries the compact city menu, like the desktop bar', () => {
    const nav = src('components/Navbar.tsx')
    const mobile = nav.slice(nav.indexOf('{/* Mobile right */}'))
    expect(mobile).toContain('variant="compact"')
  })
  it('the compact variant names the current city and renders nothing without one', () => {
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain("variant === 'compact'")
    expect(m).toContain('if (!current) return null')
    expect(m).toContain('{current.name}')
  })

  it('the sheet dims the page, locks scroll, and documents its header dependency', () => {
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain('bg-black/25')
    expect(m).toContain("document.body.style.overflow = 'hidden'")
    expect(m).toContain('backdrop-blur')
  })

  it('the current city is visibly shaded, at home or away', () => {
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain("'bg-amber-100 text-amber-800 font-semibold' : 'bg-gray-100 text-gray-700 font-medium'")
    expect(m).toContain("? 'bg-amber-100 text-amber-800 font-semibold'\n        : 'text-gray-700 hover:bg-gray-50'")
  })

  it('desktop shows no city control until a city is known, same as the phone pill', () => {
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain('<Link href="/cities"')
    expect(m).toContain('        Cities\n      </Link>')
    expect(m).not.toContain("current?.name ?? 'Cities'")
  })

  it('tapping the city you are already on closes the sheet instead of reloading', () => {
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain('current?.slug === c.slug && pathname === `/${c.slug}`')
    expect(m).toContain('if (pathname === `/${c.slug}`) e.preventDefault()')
  })

  it('a guest with no cookie is shown the page city (Istanbul by default), and can go back to the default', () => {
    const l = src('app/layout.tsx')
    expect(l).toContain('?.slug ?? (session ? undefined : footerCitySlug)')
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain('const backSlug = homeSlug ?? defaultSlug')
    expect(m).toContain('/app/api/city/enter?city=${backSlug}&to=city')
  })
})
