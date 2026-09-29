import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Perks scan 2026-09-29, items 1–10.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page = read('app/(member)/perks/page.tsx')

describe('member perks', () => {
  it('1: the Perks links appear only where a partner is live', () => {
    const layout = read('app/layout.tsx')
    expect(layout).toContain("session ? prisma.partner.count({ where: { cityId: sessionCityId, isActive: true } }) : Promise.resolve(0),")
    expect(layout).toContain('hasPerks={hasPerks}')
    expect(read('components/Footer.tsx')).toContain("...(hasPerks ? [{ href: '/perks', label: 'Member Perks 🎁' }] : []),")
    expect(read('components/AccountMenu.tsx')).toContain('{hasPerks && (')
    expect(read('components/Navbar.tsx')).toContain('<AccountMenu onItemClick={() => setDropdownOpen(false)} hasPerks={hasPerks} />')
    expect(read('components/BottomNav.tsx')).toContain('<AccountMenu onItemClick={() => setSheetOpen(false)} hasPerks={hasPerks} />')
  })
  it('2: claiming uses the member card\'s live pass, not a profile screenshot', () => {
    expect(page).not.toContain('just show your Smileys profile')
    expect(page).toContain('show the live pass at the till')
    const card = read('app/(member)/card/page.tsx')
    expect(card).toContain('function LivePass({ name }: { name: string })')
    expect(card).toContain('const t = setInterval(() => setNow(new Date()), 1000)')
    expect(card).toContain("hourCycle: 'h23'")
    expect(card).not.toContain("it isn&apos;t a pass or a membership check")
  })
  it('3: a failed load is an error with a retry', () => {
    expect(page).toContain('.then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))')
    expect(page).toContain("We couldn&apos;t load the perks")
    expect(page).toContain('onClick={load}')
  })
  it('4: the city is named', () => {
    expect(page).toContain("Local Perks{city?.name ? ` in ${city.name}` : ''}")
  })
  it('5: only safe links render', () => {
    expect(page).toContain("w.startsWith('https://') && isSafeHref(w)")
    expect(page).toContain('/^[A-Za-z0-9._]{1,30}$/.test(u)')
  })
  it('6: members can suggest a place, with the city', () => {
    expect(page).toContain("`/contact?topic=partnership${city?.slug ? `&city=${city.slug}` : ''}`")
  })
  it('7: search covers what the card shows', () => {
    expect(page).toContain('[p.name, p.neighborhood, p.category, p.discount, p.address].some(')
  })
  it('8: accessible filters, images and icons', () => {
    expect(page).toContain('aria-pressed={category === c}')
    expect(page).toContain('<img src={cover} alt=""')
    expect(page).not.toContain('text-gray-400')
    expect(page).not.toContain('text-gray-300')
    expect(page).toContain('<label htmlFor="perks-search" className="sr-only">')
  })
  it('9: its own title, not indexed', () => {
    const layout = read('app/(member)/perks/layout.tsx')
    expect(layout).toContain("title:  'Member perks — Smileys Community',")
    expect(layout).toContain('robots: { index: false, follow: false },')
  })
  it('10: the discount pill is dark text on the amber', () => {
    expect(page).toContain('bg-amber-500 text-amber-950 text-xs font-bold')
  })
})
