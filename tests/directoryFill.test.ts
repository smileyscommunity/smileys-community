import { describe, it, expect } from 'vitest'
import {
  buildFillPatch, cleanSources, composeDescription, decodeForSearch, coverDimensionsOk, coverLooksLikePhoto, instagramFromClaims,
  isPlaceTag, isPlaceholderDescription, normalizePhone, normalizeWebsiteClaim, ogImageFrom,
  siteMentionsPlace, smileysSinceSentence, visibleTextLength, websiteLandingOk, MIN_READABLE_TEXT,
  THIN_DESCRIPTION, type FillableRow, type VenueResearch,
} from '@/lib/directoryFill'

// scripts/fill-directory-listings.ts turns web research into directory rows.
// The row is a factual promise to members, so these pin the two things that
// keep a model's research from becoming a wrong promise: only empty fields
// are filled, and every claim goes through the admin form's validators.

const row = (over: Partial<FillableRow> = {}): FillableRow => ({
  name: 'Crumpet London',
  description: 'Community venue — added from a Smileys event. Pending review.',
  website: null, instagram: null, phone: null, address: null, hours: null, languages: null,
  tags: ['We meet here'], coverImage: null,
  ...over,
})

const LONG = 'A small British café in Yeldeğirmeni run by a London-born owner, built around proper crumpets with a full English breakfast for when you need one.'

const research = (over: Partial<VenueResearch> = {}): VenueResearch => ({
  found: true, is_business: true, permanently_closed: false,
  description: LONG,
  website: 'https://www.crumpetlondon1992.com/',
  instagram: '@crumpetlondon1992',
  phone: '+90 216 123 45 67',
  address: 'Rasimpaşa, İzzettin Sk. 68b, Kadıköy',
  hours: { mon: 'closed', tue: '09:30-18:00', wed: '09:30-18:00', thu: '09:30-18:00', fri: '09:30-18:00', sat: '09:30-18:00', sun: '09:30-18:00' },
  hours_confident: true,
  languages: 'English, Turkish',
  tags: ['Crumpets', 'brunch', 'british'],
  sources: ['https://example.com/a'],
  notes: '',
  ...over,
})

describe('placeholder descriptions', () => {
  it('treats every import placeholder as empty', () => {
    expect(isPlaceholderDescription('Community venue — added from a Smileys event. Pending review.')).toBe(true)
    expect(isPlaceholderDescription('Community venue—added from a Smileys event.')).toBe(true)
    expect(isPlaceholderDescription('A Kadıköy regular for the Smileys community, hosting Smileys events since July 2026.')).toBe(true)
    expect(isPlaceholderDescription('Cafe in Bitez. Rated 4.5 across 120 Google reviews. Awaiting an editorial description before approval.')).toBe(true)
    expect(isPlaceholderDescription('Karaoke Bar in Beyoglu')).toBe(true)
    expect(isPlaceholderDescription('')).toBe(true)
  })
  it('keeps a real description', () => {
    expect(isPlaceholderDescription(LONG)).toBe(false)
  })
  it('keeps a real description that ends with the since-fact the fill appends', () => {
    // Polo Pastanesi, as the 2026-09-28 run wrote it.
    const polo = 'A long-running patisserie and café on Cumhuriyet Caddesi, Polo Pastanesi serves a wide range of cakes, pastries and savory dishes and has indoor and terrace seating. Hosting Smileys events since May 2026.'
    expect(isPlaceholderDescription(polo)).toBe(false)
    expect(isPlaceholderDescription('Sunset sailing cruises from Kalamış Marina, hosting Smileys events since May 2026.')).toBe(true)
  })
  it('extracts the since-sentence', () => {
    expect(smileysSinceSentence('… hosting Smileys events since July 2026.')).toBe('Hosting Smileys events since July 2026.')
    expect(smileysSinceSentence('Sunset cruises, hosting Smileys events since May 2026.')).toBe('Hosting Smileys events since May 2026.')
    expect(smileysSinceSentence(LONG)).toBeNull()
  })
})

describe('composeDescription', () => {
  it('appends the since-fact from the old placeholder, once', () => {
    const d = composeDescription(LONG, 'Spice Corner, hosting Smileys events since July 2026.')
    expect(d!.endsWith(' Hosting Smileys events since July 2026.')).toBe(true)
    expect(composeDescription(`${LONG} Hosting Smileys events since July 2026.`, 'x hosting Smileys events since July 2026.')!.match(/Smileys events since/g)).toHaveLength(1)
  })
  it('strips emoji and exclamation marks, ends with a full stop', () => {
    expect(composeDescription('Great crumpets 🥞 and tea!', '')).toBe('Great crumpets and tea.')
    expect(composeDescription('No punctuation at the end', '')).toBe('No punctuation at the end.')
  })
  it('returns null for nothing', () => {
    expect(composeDescription(null, 'x')).toBeNull()
    expect(composeDescription('   ', 'x')).toBeNull()
  })
})

describe('website + instagram claims', () => {
  it('upgrades to https and adds a scheme', () => {
    expect(normalizeWebsiteClaim('http://example.com/menu')).toBe('https://example.com/menu')
    expect(normalizeWebsiteClaim('example.com')).toBe('https://example.com')
  })
  it('refuses social profiles as a website', () => {
    expect(normalizeWebsiteClaim('https://www.instagram.com/crumpetlondon1992/')).toBeNull()
    expect(normalizeWebsiteClaim('https://facebook.com/p/Crumpet-London')).toBeNull()
    expect(normalizeWebsiteClaim('https://goo.gl/maps/abc')).toBeNull()
  })
  it('takes the handle from a handle, an @handle or a profile URL', () => {
    expect(instagramFromClaims('@crumpetlondon1992', null)).toBe('crumpetlondon1992')
    expect(instagramFromClaims('https://www.instagram.com/crumpetlondon1992/?hl=en', null)).toBe('crumpetlondon1992')
    expect(instagramFromClaims(null, 'https://instagram.com/crumpetlondon1992')).toBe('crumpetlondon1992')
    expect(instagramFromClaims('evil.com/x', null)).toBeNull()
  })
})

describe('buildFillPatch', () => {
  it('fills every empty field from research, keeping staff tags', () => {
    const { patch, skipped } = buildFillPatch(row(), research(), { websiteOk: true })
    expect(patch.description).toBe(LONG)
    expect(patch.website).toBe('https://www.crumpetlondon1992.com/')
    expect(patch.instagram).toBe('crumpetlondon1992')
    expect(patch.phone).toBe('+90 216 123 45 67')
    expect(patch.address).toBe('Rasimpaşa, İzzettin Sk. 68b, Kadıköy')
    expect(patch.languages).toBe('English, Turkish')
    expect(patch.hours).toEqual({ mon: null, tue: '09:30-18:00', wed: '09:30-18:00', thu: '09:30-18:00', fri: '09:30-18:00', sat: '09:30-18:00', sun: '09:30-18:00' })
    expect(patch.tags).toEqual(['We meet here', 'crumpets', 'brunch', 'british'])
    expect(skipped).toEqual({})
  })

  it('never touches a filled field without --overwrite', () => {
    const full = row({
      description: LONG, website: 'https://kept.example', instagram: 'kept', phone: '1', address: 'kept',
      hours: { mon: '09:00-17:00' }, languages: 'Turkish', tags: ['We meet here', 'crumpets', 'brunch', 'british'],
    })
    const { patch, skipped } = buildFillPatch(full, research(), { websiteOk: true })
    expect(patch).toEqual({})
    expect(Object.keys(skipped).sort()).toEqual(['address', 'description', 'hours', 'instagram', 'languages', 'phone', 'tags', 'website'])
    expect(skipped.description).toMatch(/--overwrite/)
  })

  it('--overwrite replaces a real description but still validates', () => {
    const { patch } = buildFillPatch(row({ description: LONG, website: 'https://old.example' }), research(), { overwrite: true, websiteOk: true })
    expect(patch.description).toBe(LONG)   // same text → still returned; the script writes it, prisma no-ops
    expect(patch.website).toBe('https://www.crumpetlondon1992.com/')
  })

  it('stores a website only when the script confirmed it answers', () => {
    expect(buildFillPatch(row(), research(), { websiteOk: false }).patch.website).toBeUndefined()
    expect(buildFillPatch(row(), research(), { websiteOk: false }).skipped.website).toMatch(/did not respond/)
    expect(buildFillPatch(row(), research(), {}).patch.website).toBeUndefined()
    expect(buildFillPatch(row(), research(), {}).skipped.website).toMatch(/not checked/)
  })

  it('moves an Instagram URL given as the website into the instagram column', () => {
    const r = research({ website: 'https://www.instagram.com/crumpetlondon1992/', instagram: null })
    const { patch, skipped } = buildFillPatch(row(), r, { websiteOk: true })
    expect(patch.website).toBeUndefined()
    expect(patch.instagram).toBe('crumpetlondon1992')
    expect(skipped.website).toMatch(/not a website we store/)
  })

  it('reads a 24:00 close as 23:59', () => {
    const r = research({ hours: { mon: '10:00-24:00', tue: '10:00-24:00', wed: null, thu: null, fri: null, sat: null, sun: 'closed' } })
    expect(buildFillPatch(row(), r, { websiteOk: true }).patch.hours).toEqual({ mon: '10:00-23:59', tue: '10:00-23:59', wed: null, thu: null, fri: null, sat: null, sun: null })
  })
  it('drops hours the researcher is not confident about, or that fail the form validator', () => {
    expect(buildFillPatch(row(), research({ hours_confident: false }), { websiteOk: true }).patch.hours).toBeUndefined()
    const bad = research({ hours: { mon: '9am-6pm', tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } })
    const { patch, skipped } = buildFillPatch(row(), bad, { websiteOk: true })
    expect(patch.hours).toBeUndefined()
    expect(skipped.hours).toMatch(/Invalid range for mon/)
    const allClosed = research({ hours: { mon: 'closed', tue: 'closed', wed: 'closed', thu: 'closed', fri: 'closed', sat: 'closed', sun: 'closed' } })
    expect(buildFillPatch(row(), allClosed, { websiteOk: true }).skipped.hours).toMatch(/no open day/)
  })

  it('rejects a description that is still thin, and a phone with no digits', () => {
    const { patch, skipped } = buildFillPatch(row(), research({ description: 'Nice cafe.', phone: 'call us' }), { websiteOk: true })
    expect(patch.description).toBeUndefined()
    expect(skipped.description).toMatch(/too short/)
    expect(patch.phone).toBeUndefined()
    expect(skipped.phone).toMatch(/phone/)
    expect(THIN_DESCRIPTION).toBe(60)
  })

  it('writes nothing when the venue was not found', () => {
    const { patch, skipped } = buildFillPatch(row(), research({ found: false }), { websiteOk: true })
    expect(patch).toEqual({})
    expect(skipped.all).toMatch(/not found/)
  })

  it('drops tags that only repeat the place or say nothing', () => {
    const r = research({ tags: ['Kadıköy', 'kadikoy', 'Istanbul', 'neighborhood', 'biryani'] })
    const { patch } = buildFillPatch(row(), r, { websiteOk: true, placeNames: ['Kadıköy', 'Istanbul'] })
    expect(patch.tags).toEqual(['We meet here', 'biryani'])
  })

  it('is idempotent even with a since-fact and staff tags: a second pass plans nothing', () => {
    const start = row({ description: 'Spice Corner, a Kadıköy regular for the Smileys community, hosting Smileys events since July 2026.' })
    const first = buildFillPatch(start, research(), { websiteOk: true }).patch
    expect(first.description).toMatch(/Hosting Smileys events since July 2026\.$/)
    expect(first.tags).toEqual(['We meet here', 'crumpets', 'brunch', 'british'])
    const filled = row({ ...start, ...first, coverImage: '/app/api/files/directory/x.jpg' })
    // A second research pass returns different wording and near-duplicate tags.
    const again = research({ description: `${LONG} Slightly different.`, tags: ['cafe-bar', 'crumpet', 'tea'] })
    expect(buildFillPatch(filled, again, { websiteOk: true }).patch).toEqual({})
  })

  it('is idempotent: a second pass over the filled row plans nothing', () => {
    const first = buildFillPatch(row(), research(), { websiteOk: true }).patch
    const filled = row({ ...first, coverImage: '/app/api/files/directory/x.jpg' })
    const second = buildFillPatch(filled, research(), { websiteOk: true })
    expect(second.patch).toEqual({})
  })
})

describe('phone numbers', () => {
  // Shapes the researcher returned in the 2026-09-28 dry runs.
  it('rewrites every Turkish shape to +90 XXX XXX XX XX', () => {
    expect(normalizePhone('+90 0216 700 1111', 'TR')).toBe('+90 216 700 11 11')
    expect(normalizePhone('(533) 666 68 26', 'TR')).toBe('+90 533 666 68 26')
    expect(normalizePhone('+90 (850) 307 7109', 'TR')).toBe('+90 850 307 71 09')
    expect(normalizePhone('0212 244 79 73', 'TR')).toBe('+90 212 244 79 73')
    expect(normalizePhone('+90 549 418 6666', 'TR')).toBe('+90 549 418 66 66')
  })
  it('refuses what is not a Turkish number, keeps other countries as published', () => {
    expect(normalizePhone('444 1 555', 'TR')).toBeNull()
    expect(normalizePhone('call us', 'TR')).toBeNull()
    expect(normalizePhone('+995 32 222 22 22', 'GE')).toBe('+995 32 222 22 22')
  })
  it('drops the handle that came with another venue\'s website', () => {
    const { patch, skipped } = buildFillPatch(row(), research(), { websiteOk: false, wrongVenue: true })
    expect(patch.instagram).toBeUndefined()
    expect(skipped.instagram).toMatch(/another venue/)
  })
})

describe('tags that are places or opinions', () => {
  // Every one of these came back from the first full dry run (2026-09-28).
  it('drops place names from the address, neighborhood and "near X"', () => {
    const where = ['Kadıköy', 'Istanbul', 'Rasimpaşa, Karakolhane Cd. No:55/A, Yeldeğirmeni', 'Kılıçali Paşa, Galataport L5 Blok, Beyoğlu', 'Asmalı Mescit, Tütüncü Çk. 4']
    for (const t of ['yeldegirmeni', 'Yeldeğirmeni', 'galataport', 'asmali mescit', 'near taksim', 'near istiklal', 'kadıköy']) {
      expect(isPlaceTag(t, where), t).toBe(true)
    }
    for (const t of ['specialty coffee', 'rooftop', 'tea', 'live music', 'craft beer']) {
      expect(isPlaceTag(t, where), t).toBe(false)
    }
  })
  it('drops opinions from the planned tags', () => {
    const r = research({ tags: ['chain', 'budget', 'authentic', 'cozy', 'biryani'] })
    expect(buildFillPatch(row(), r, { websiteOk: true }).patch.tags).toEqual(['We meet here', 'biryani'])
  })
})

describe('sources and website landing', () => {
  it('unwraps markdown links, strips utm, drops our own site, dedupes', () => {
    expect(cleanSources([
      '([musafirindian.com](https://www.musafirindian.com/?utm_source=openai))',
      'https://www.musafirindian.com/',
      'https://smileyscommunity.com/app/directory/abc',
      'https://yandex.com/maps/org/x/1/?utm_source=openai&z=3',
      'not a url',
    ])).toEqual(['https://www.musafirindian.com/', 'https://yandex.com/maps/org/x/1/?z=3'])
  })
  it('accepts the same brand under another suffix', () => {
    expect(websiteLandingOk('https://musafirindian.com.tr', 'https://musafirindian.com/')).toBe(true)
    expect(websiteLandingOk('https://qr.bitz.com.tr/menu', 'https://bitz.com.tr/')).toBe(true)
  })
  it('knows when a site is about another place', () => {
    const canada = '<html><title>The Roastory Coffee</title><p>Find us in Toronto, Ontario</p></html>'
    const istiklal = '<html><footer>İstiklal Cad. No:87, Beyoğlu / İstanbul</footer></html>'
    expect(siteMentionsPlace(canada, ['Istanbul', 'Beyoğlu'], 'TR')).toBe(false)
    expect(siteMentionsPlace(istiklal, ['Istanbul', 'Beyoğlu'], 'TR')).toBe(true)
    expect(siteMentionsPlace('<p>Türkiye genelinde 40 şube</p>', ['Istanbul'], 'TR')).toBe(true)
    expect(siteMentionsPlace('<div id="root"></div>', ['Istanbul'], 'TR', 'https://www.x.com.tr/')).toBe(true)
    expect(siteMentionsPlace('<div id="root"></div>', ['Tbilisi'], 'GE', 'https://www.x.com.tr/')).toBe(false)
  })
  it('finds the city inside JS escapes and HTML entities, and by the venue phone', () => {
    // Moda Sahnesi and Polo Pastanesi were refused as "another venue" by the
    // first write run (2026-09-28) for exactly these reasons.
    expect(siteMentionsPlace('<script>{"city":"\\u0130stanbul"}</script>', ['Istanbul'], 'GE')).toBe(true)
    expect(siteMentionsPlace('<p>Kad&#305;k&ouml;y</p>', ['Kadıköy'], 'GE')).toBe(true)
    expect(decodeForSearch('Kad&#x131;k&#246;y &amp; Moda')).toBe('Kadıköy & Moda')
    const polo = '<footer>Rezervasyon: 0212 240 74 46</footer>'
    expect(siteMentionsPlace(polo, ['Istanbul', 'Taksim'], 'GE', undefined, ['+90 212 240 74 46'])).toBe(true)
    expect(siteMentionsPlace(polo, ['Istanbul', 'Taksim'], 'GE', undefined, ['+90 212 999 00 00'])).toBe(false)
  })
  it('tells a script-only shell from a page that talks about somewhere else', () => {
    const shell = '<html><head><script>' + 'x'.repeat(5000) + '</script><style>.a{}</style></head><body><div id="app"></div></body></html>'
    expect(visibleTextLength(shell)).toBeLessThan(MIN_READABLE_TEXT)
    expect(visibleTextLength('<p>' + 'Find us in Toronto. '.repeat(40) + '</p>')).toBeGreaterThanOrEqual(MIN_READABLE_TEXT)
  })
  it('accepts www and subdomain moves, refuses another domain or a login page', () => {
    expect(websiteLandingOk('https://bitz.com.tr/', 'https://www.bitz.com.tr/')).toBe(true)
    expect(websiteLandingOk('https://www.x.com.tr/', 'https://x.com.tr/en')).toBe(true)
    expect(websiteLandingOk('https://rocknrolla.com.tr', 'https://rocknrolla.com.tr/admin/login')).toBe(false)
    expect(websiteLandingOk('https://cafe.example', 'https://www.sedoparking.com/cafe.example')).toBe(false)
    expect(websiteLandingOk('https://cafe.example', 'https://cafe.example/wp-login.php?redirect_to=x')).toBe(false)
  })
})

describe('cover from the venue site', () => {
  it('reads og:image, preferring secure_url, resolving relative paths, https only', () => {
    const html = `<html><head>
      <meta property="og:title" content="Crumpet London">
      <meta content="/img/hero.jpg" property="og:image">
      <meta name="twitter:image" content="https://cdn.example/tw.jpg">
    </head></html>`
    expect(ogImageFrom(html, 'https://www.crumpetlondon1992.com/menu')).toBe('https://www.crumpetlondon1992.com/img/hero.jpg')
    expect(ogImageFrom('<meta property="og:image:secure_url" content="https://s.example/a.jpg"><meta property="og:image" content="http://s.example/b.jpg">', 'https://x.example')).toBe('https://s.example/a.jpg')
    expect(ogImageFrom('<meta property="og:image" content="http://insecure.example/a.jpg">', 'https://x.example')).toBeNull()
    expect(ogImageFrom('<html></html>', 'https://x.example')).toBeNull()
  })
  it('wants a photo, not a logo card', () => {
    // Real values from 2026-09-28: The Populist's bar photo vs But First Coffee's logo card.
    expect(coverLooksLikePhoto('https://www.thepopulist.com.tr/static/uploads/2026/01/bg-1p.webp', 6.95)).toBe(true)
    expect(coverLooksLikePhoto('https://butfirstcoffee.com.tr/cdn/shop/files/cover.jpg', 1.25)).toBe(false)
    expect(coverLooksLikePhoto('https://butfirstcoffee.com.tr/cdn/shop/files/1200x512_BFC_Logo.jpg?v=1', 7.5)).toBe(false)
    expect(coverLooksLikePhoto('https://x.example/a.jpg', undefined)).toBe(false)
    // The screenshot written for Karakoy Afrodit on 2026-09-28 (reverted).
    expect(coverLooksLikePhoto('https://pub-bb2e.r2.dev/2b7a/id-preview-b2236ce6--7cb3.lovable.app-1778525625137.png', 7.4)).toBe(false)
  })
  it('wants a hero-shaped image, not a logo strip or a thumbnail', () => {
    expect(coverDimensionsOk(1200, 630)).toBe(true)
    expect(coverDimensionsOk(828, 624)).toBe(true)
    expect(coverDimensionsOk(400, 300)).toBe(false)
    expect(coverDimensionsOk(2000, 300)).toBe(false)
    expect(coverDimensionsOk(600, 1400)).toBe(false)
    expect(coverDimensionsOk(undefined, 300)).toBe(false)
  })
})
