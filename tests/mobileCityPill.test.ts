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
    expect(m).toContain('if (!signedIn || !current) return null')
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

  it('a signed-out visitor gets a plain Cities link to /cities, no named picker, no assumed default', () => {
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain('if (!signedIn || !current) {')
    expect(m).toContain('<Link href="/cities"')
    expect(m).toContain('        Cities\n      </Link>')
    expect(m).not.toContain("current?.name ?? 'Cities'")
    expect(m).toContain('if (!signedIn || !current) return null')
  })

  it('tapping the city you are already on closes the sheet instead of reloading', () => {
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain('current?.slug === c.slug && pathname === `/${c.slug}`')
    expect(m).toContain('if (pathname === `/${c.slug}`) e.preventDefault()')
  })

  it('guests are not assumed to be viewing any city, and get no back-to-home row', () => {
    expect(src('app/layout.tsx')).not.toContain('(session ? undefined : footerCitySlug)')
    const m = src('components/CitiesMenu.tsx')
    expect(m).toContain('const away     = signedIn && !!current && current.slug !== homeSlug')
    expect(m).not.toContain('backSlug')
  })
})
