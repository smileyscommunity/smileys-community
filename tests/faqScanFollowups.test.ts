import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { splitSiteAddresses } from '@/lib/siteAddresses'
import FAQ from '@/lib/faqDefault.json'

// FAQ scan 2026-09-29, items 1–9.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const page   = read('app/faq/page.tsx')
const script = read('scripts/apply-faq-content.ts')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require('../next.config.js')

const answers = FAQ.flatMap(s => s.items)
const answer  = (q: string) => answers.find(i => i.q === q)?.a ?? ''
const all     = answers.map(i => `${i.q} ${i.a}`).join('\n')

describe('1: answers match the product', () => {
  it('no hardcoded city list; cities page instead', () => {
    expect(all).not.toContain('Istanbul, Bodrum and İzmir')
    expect(answer('What is Smileys Community?')).toContain('smileyscommunity.com/app/cities')
  })
  it('waitlist is first to claim, not auto-promotion', () => {
    expect(answer('What is the waitlist?')).toContain('the first person to claim it gets the spot')
    expect(all).not.toContain('automatically promoted')
  })
  it('password, email and deletion live in Settings; reset link lasts 1 hour', () => {
    expect(answer('How do I change my password?')).toContain('Settings')
    expect(answer('How do I change my email address?')).toContain('Settings')
    expect(answer('How do I delete my account?')).toContain('Settings')
    expect(answer('I forgot my password. What do I do?')).toContain('1 hour')
    expect(all).not.toContain('24 hours')
  })
  it('gender balance is per event, not "many"', () => {
    expect(answer('Are events gender-balanced?')).toMatch(/^Some are/)
  })
})

describe('2: addresses work and are links', () => {
  it('bare-domain /apply and /appeal reach the app (nginx passes any /app… prefix unchanged)', async () => {
    const redirects = await nextConfig.redirects()
    for (const [source, destination] of [['/apply', '/app/apply'], ['/apply/:path*', '/app/apply/:path*'], ['/appeal', '/app/appeal']]) {
      expect(redirects).toContainEqual({ source, destination, basePath: false, permanent: true })
    }
  })
  it('every address in the FAQ carries /app', () => {
    for (const m of all.matchAll(/smileyscommunity\.com(\/\S*)?/g)) expect(m[0]).toMatch(/^smileyscommunity\.com\/app\//)
  })
  it('splits addresses into links, keeping the query and dropping the full stop', () => {
    expect(splitSiteAddresses('Go to smileyscommunity.com/app/settings.')).toEqual([
      { text: 'Go to ' }, { text: 'smileyscommunity.com/app/settings', href: '/settings' }, { text: '.' },
    ])
    expect(splitSiteAddresses('at smileyscommunity.com/app/contact?topic=club-proposal. We')).toEqual([
      { text: 'at ' }, { text: 'smileyscommunity.com/app/contact?topic=club-proposal', href: '/contact?topic=club-proposal' }, { text: '. We' },
    ])
    expect(splitSiteAddresses('smileyscommunity.com/events')).toEqual([{ text: 'smileyscommunity.com/events', href: '/events' }])
    expect(splitSiteAddresses('no address here')).toEqual([{ text: 'no address here' }])
    // "/app" is only the basePath as a whole segment (caught on the local page).
    expect(splitSiteAddresses('at smileyscommunity.com/apply.')[1]).toEqual({ text: 'smileyscommunity.com/apply', href: '/apply' })
    expect(splitSiteAddresses('smileyscommunity.com/appeal')[0]).toEqual({ text: 'smileyscommunity.com/appeal', href: '/appeal' })
    expect(splitSiteAddresses('smileyscommunity.com/app')[0]).toEqual({ text: 'smileyscommunity.com/app', href: '/' })
  })
  it('the page renders answers through the splitter', () => {
    expect(page).toContain('{linkify(faq.a)}')
    expect(page).toContain('splitSiteAddresses(a)')
  })
})

describe('3–5: new steps and topics', () => {
  it('after applying: confirm the email first', () => {
    expect(answer('What happens after I apply?')).toMatch(/^We email you a link to confirm your address/)
  })
  it('club ideas go to the Propose a club topic', () => {
    expect(answer('Can I start my own club?')).toContain('contact?topic=club-proposal')
  })
  it('hosting, cities, check-in, no-shows, hangouts, privacy, notifications are covered', () => {
    for (const q of [
      'How do I become a host?', 'What is a City Lead?', 'Can I be part of more than one city?',
      "I'm visiting another city. Can I join its events?", "My city isn't open yet. What can I do?",
      'How does check-in work?', "What happens if I can't make it?", 'What are hangouts?',
      'Can I limit who sees my profile?', 'How do I control notifications?',
    ]) expect(answer(q), q).not.toBe('')
    expect(FAQ.map(s => s.id)).toEqual(['getting-started', 'applications', 'events', 'clubs', 'hosting', 'cities', 'account', 'safety'])
  })
})

describe('6: the code fallback is the reviewed text', () => {
  it('SECTIONS comes from lib/faqDefault.json, the file the apply script writes to the server', () => {
    expect(page).toContain('const SECTIONS: Section[] = FAQ_DEFAULT.map(')
    expect(page).not.toContain("q: 'What is the waitlist?'")
    expect(script).toContain('npx tsx scripts/apply-faq-content.ts lib/faqDefault.json')
  })
  it('the apply script replaces only faq, dry-runs by default, and refuses a changed FAQ', () => {
    expect(script).toContain("if (process.env.COMMIT !== '1') {")
    expect(script).toContain('if (process.env.EXPECT_SHA !== sha) fail(')
    expect(script).toContain('content.faq = next')
    expect(script.indexOf('fs.writeFileSync(backup, raw)')).toBeLessThan(script.indexOf('fs.renameSync(tmp, FILE)'))
  })
})

describe('7–9: CTA text, structure, promises', () => {
  it('dark text on the amber card; the button is untouched', () => {
    expect(page).toContain('<h2 className="text-2xl font-extrabold text-amber-950 mb-2">Still have questions?</h2>')
    expect(page).not.toContain('text-amber-100')
    expect(page).toContain('className="btn-white !px-7 !py-3 !text-sm">Contact us</Link>')
  })
  it('questions are headings; emoji hidden from screen readers', () => {
    expect(page).toContain('<h3 className="text-sm font-bold text-gray-900 mb-2.5 leading-snug">{faq.q}</h3>')
    expect(page).toContain('<span aria-hidden="true">{s.icon}</span>')
    expect(page).toContain('<span aria-hidden="true">❓</span> Help Centre')
    expect(page).toContain('<div aria-hidden="true" className="text-3xl mb-3">💬</div>')
  })
  it('no response times nobody tracks', () => {
    expect(page).not.toContain('business days')
    expect(all).not.toContain('business days')
    expect(answer('My account was suspended. How do I appeal?')).toContain("If we restore your account, you'll get an email.")
  })
})

describe('share card', () => {
  it('uses the FAQ banner crop, 1200×630 and under WhatsApp\'s ~300KB limit', async () => {
    const { statSync } = await import('fs')
    expect(page).toContain('const ogImage = `${APP_URL}/images/faq-og.jpg`')
    expect(page).toContain('images: [{ url: ogImage, width: 1200, height: 630, alt: ogAlt }],')
    expect(statSync(join(process.cwd(), 'public/images/faq-og.jpg')).size).toBeLessThan(300_000)
  })
})
