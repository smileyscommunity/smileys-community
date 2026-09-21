import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { describeAttrs, statusPill, contactRender, isAvailable, FILLED_LABEL } from '@/lib/listingDisplay'

// The marketplace UI review (2026-09-21). What these pin: the category fields
// a poster fills in are actually rendered; a listing's status is visible to
// the person who posted it; a WhatsApp-green button only ever points at
// WhatsApp; posting lands on the listing you just wrote; and the permalink is
// a real page rather than a 404 the moment a listing sells.

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const HUB   = src('components/BoardHub.tsx')
const NEW   = src('app/(member)/board/new/page.tsx')
const PERMA = src('app/board/[id]/page.tsx')

describe('category attributes are shown, not just stored', () => {
  it('names every key the API allowlists, in a fixed order', () => {
    const rows = describeAttrs({
      petGoal: 'foster', online: true, rateUnit: 'hour', remote: 'hybrid',
      jobType: 'gig', furnished: false, availableFrom: '2026-10-01', housingType: 'sublet',
    })
    expect(rows.map(r => r.label)).toEqual([
      'Type', 'Available from', 'Furnished', 'Job type', 'Where', 'Rate', 'Online', 'Looking for',
    ])
    expect(rows.map(r => r.value)).toEqual([
      'Sublet', '1 October 2026', 'No', 'One-off gig', 'Hybrid', 'Per hour', 'Also available online', 'Foster',
    ])
  })

  it('renders a bare date as its own calendar day, not the viewer’s', () => {
    // '2026-10-01' is the 1st in the listing's city. Read as an instant it
    // becomes 30 September west of UTC, which is the wrong month-end for a
    // room somebody is planning a move around.
    const [row] = describeAttrs({ availableFrom: '2026-10-01' })
    expect(row.value).toBe('1 October 2026')
  })

  it('skips what it cannot name, and the form’s default "not online"', () => {
    expect(describeAttrs({ housingType: 'castle', jobType: 'x', online: false })).toEqual([])
    expect(describeAttrs(null)).toEqual([])
    expect(describeAttrs({})).toEqual([])
  })

  it('is rendered by both the sheet and the permalink', () => {
    expect(HUB).toContain('describeAttrs(listing.attrs)')
    expect(PERMA).toContain('describeAttrs(listing.attrs')
  })
})

describe('what happened to a listing', () => {
  it('names the resolved state per category — nobody "fills" a sofa', () => {
    expect(statusPill('filled', 'BUY_SELL')!.label).toBe('Sold')
    expect(statusPill('filled', 'ROOMS')!.label).toBe('Rented')
    expect(statusPill('filled', 'PETS')!.label).toBe('Adopted')
    expect(statusPill('filled', 'WHATEVER')!.label).toBe('Filled')
    expect(statusPill('active', 'JOBS')!.label).toBe('Live')
    expect(statusPill('expired', 'JOBS')!.label).toBe('Expired')
    expect(statusPill('deleted', 'JOBS')!.label).toBe('Removed')
    expect(statusPill('something-new', 'JOBS')).toBeNull()
  })

  it('treats a missing status as available — guest payloads carry no lifecycle', () => {
    expect(isAvailable('active')).toBe(true)
    expect(isAvailable(undefined)).toBe(true)
    expect(isAvailable('filled')).toBe(false)
    expect(isAvailable('expired')).toBe(false)
  })

  it('shows the pill on Mine and Saved cards and in the sheet', () => {
    expect(HUB).toContain("showStatus={category === 'MINE' || category === 'SAVED'}")
    expect(HUB).toContain('statusPill(listing.status, listing.category)')
  })

  it('tells the owner an expired listing can be renewed', () => {
    expect(HUB).toContain('renew it below to put it back on the marketplace')
  })

  it('says how many saved listings have gone, instead of dropping them', () => {
    expect(HUB).toContain('savedGone > 0')
    expect(HUB).toContain('no longer available')
  })
})

describe('the owner’s actions', () => {
  it('renew is an addition near expiry, never a replacement for marking it done', () => {
    // The bug: `daysLeft <= 7 ? <Renew/> : <Resolve/>` — the last week of a
    // listing's life, which is when it most often sells, had no way to say so.
    expect(HUB).not.toMatch(/daysLeft <= 7\s*\n?\s*\?/)
    expect(HUB).toContain("((live && daysLeft <= 7) || listing.status === 'expired')")
  })

  it('renew and mark-as-done both report success and failure', () => {
    const renew = HUB.slice(HUB.indexOf('async function handleRenew'), HUB.indexOf('async function handleEditListing'))
    expect(renew).toContain('toast.error')
    expect(renew).toContain('toast.success')
    const filled = HUB.slice(HUB.indexOf('async function handleMarkFilled'), HUB.indexOf('async function handleRenew'))
    expect(filled).toContain('toast.error')
    expect(filled).toContain('toast.success')
  })

  it('offers no contact composer on a listing the endpoint would refuse', () => {
    expect(HUB).toContain('isLoggedIn && !isOwner && live && !contactSent')
  })
})

describe('the contact button says what it links to', () => {
  it('turns a phone number into a wa.me link', () => {
    expect(contactRender('+90 555 111 22 33')).toEqual({ kind: 'whatsapp', href: 'https://wa.me/905551112233' })
  })

  it('keeps WhatsApp’s own hosts green', () => {
    expect(contactRender('https://wa.me/905551112233')!.kind).toBe('whatsapp')
    expect(contactRender('https://api.whatsapp.com/send?phone=905551112233')!.kind).toBe('whatsapp')
    expect(contactRender('https://chat.whatsapp.com/AbC123')!.kind).toBe('whatsapp')
  })

  it('never labels another host WhatsApp', () => {
    // A legacy row can hold any link: the old code used anything starting
    // with `http` as the href behind a WhatsApp-branded button.
    expect(contactRender('https://example.com/pay')).toEqual({ kind: 'link', href: 'https://example.com/pay' })
    expect(contactRender('https://wa.me.evil.com/905551112233')!.kind).toBe('link')
  })

  it('refuses to make a link out of an unsafe scheme', () => {
    expect(contactRender('javascript:alert(1)')).toEqual({ kind: 'text', text: 'javascript:alert(1)' })
    expect(contactRender('http://insecure.example')!.kind).toBe('text')
    expect(contactRender('')).toBeNull()
    expect(contactRender(null)).toBeNull()
  })

  it('is how both surfaces read the field', () => {
    expect(HUB).toContain('contactRender(listing.contact)')
    expect(PERMA).toContain('contactRender(listing.contact)')
    // The old hand-rolled version, on either surface, is the bug.
    expect(HUB).not.toContain("listing.contact.startsWith('http')")
    expect(PERMA).not.toContain("listing.contact.startsWith('http')")
  })
})

describe('posting a listing', () => {
  it('lands on the listing, not on the community board', () => {
    expect(NEW).not.toContain("router.push('/board')")
    expect(NEW).toContain('router.push(created?.id ? `/board/${created.id}` : \'/marketplace\')')
    expect(NEW).toContain('toast.success')
  })

  it('says which city it was filed to when that is not the one on screen', () => {
    expect(NEW).toContain('city?.posting?.differs')
    expect(NEW).toContain('the city you belong to')
  })

  it('prices in the city’s currency, capped like the API', () => {
    expect(NEW).toContain('currencySymbol(city?.currency)')
    expect(NEW).not.toContain('€500/mo')
    expect(NEW).toContain('maxLength={50}')
  })
})

describe('the sheet behaves like a modal', () => {
  it('sits above the bottom nav', () => {
    expect(HUB).toContain('fixed inset-0 z-[60] flex items-end sm:items-center')
  })

  it('locks the page behind it and listens for Escape at the document', () => {
    expect(HUB).toContain("document.body.style.overflow = 'hidden'")
    expect(HUB).toContain("document.addEventListener('keydown', onKey)")
    // Escape used to hang off a div that never receives focus.
    expect(HUB).not.toContain("onKeyDown={e => { if (e.key === 'Escape') onClose() }}")
  })

  it('closes on the Android back gesture without eating a real navigation', () => {
    expect(HUB).toContain('smileysListingSheet')
    expect(HUB).toContain("window.addEventListener('popstate', onPop)")
    // Deferred a tick, and a remount cancels it: React's development
    // mount → cleanup → mount used to queue a back() that landed on the
    // remount's own marker and closed the sheet as it opened.
    expect(HUB).toContain('if (!popped && window.history.state?.smileysListingSheet) {')
    expect(HUB).toContain('pendingSheetBack = setTimeout(() => {')
    expect(HUB).toContain('clearTimeout(pendingSheetBack)')
  })
})

describe('the browse view tells the truth about itself', () => {
  it('pages from the server’s offset, not the spliced array', () => {
    expect(HUB).toContain('fetchListings(category, neighborhood, debouncedSearch, serverOffset.current, true')
    expect(HUB).not.toContain('debouncedSearch, listings.length, true')
    expect(HUB).toContain('const seen = new Set(prev.map(l => l.id))')
  })

  it('names the filters that are on in the empty state, and always offers a way out', () => {
    expect(HUB).toContain('Nothing matches these filters')
    expect(HUB).toContain('Clear the search')
    expect(HUB).toContain('Show all areas')
    // The escape hatch used to be hidden behind `!debouncedSearch`.
    expect(HUB).not.toContain("{category !== 'SAVED' && !debouncedSearch && (")
  })

  it('drops the count badge that showed the wrong total', () => {
    expect(HUB).not.toContain("cat.id === 'ALL' && !loading && !debouncedSearch")
  })

  it('hides the controls the Moving tab ignores', () => {
    expect(HUB).toContain("{category !== 'MOVING' && (")
  })

  it('points at the report link that exists', () => {
    const safety = HUB.slice(HUB.indexOf('🛡️ Stay safe'))
    expect(safety).not.toContain('•••')
    expect(safety).toContain('Report listing')
  })
})

describe('the permalink', () => {
  it('no longer 404s a listing that sold or expired', () => {
    expect(PERMA).not.toContain("where: { id, status: 'active' }")
    expect(PERMA).toContain('This listing is no longer available')
    expect(PERMA).toContain("if (availability === 'gone') notFound()")
  })

  it('keeps a deleted row and an unknown id a 404', () => {
    expect(PERMA).toContain("if (l.status === 'deleted') return 'gone'")
    expect(PERMA).toContain('if (!raw) notFound()')
  })

  it('carries the reader back to the listing after signing in', () => {
    expect(PERMA).toContain('href={`/login?return=/board/${raw.id}`}')
  })

  it('has the gallery, the in-app contact and save/report the sheet has', () => {
    expect(PERMA).toContain('<ListingGallery')
    expect(PERMA).toContain('<ListingActions')
    expect(PERMA).not.toContain('>No contact info provided.<')
    const actions = src('components/ListingPermalink.tsx')
    expect(actions).toContain('/contact')
    expect(actions).toContain('/save')
    expect(actions).toContain('/report')
  })

  it('keeps a dead listing out of the index', () => {
    expect(PERMA).toContain('robots: live ? undefined : { index: false, follow: true }')
  })
})

describe('the vocabulary is shared', () => {
  it('the sheet’s resolve verbs and the status pill agree', () => {
    for (const cat of ['ROOMS', 'JOBS', 'PETS', 'BUY_SELL', 'FREE', 'SERVICES', 'WANTED']) {
      expect(FILLED_LABEL[cat]).toBeTruthy()
    }
  })
})
