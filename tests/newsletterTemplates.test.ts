import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { NEWSLETTER_TEMPLATES } from '@/lib/newsletterTemplates'
import { isSegment } from '@/lib/newsletterSegments'
import { sanitizeNewsletter } from '@/lib/sanitize'

describe('newsletter templates', () => {
  it('ids are unique', () => {
    const ids = NEWSLETTER_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(NEWSLETTER_TEMPLATES.map(t => [t.id, t] as const))('%s targets a real audience', (_, t) => {
    expect(isSegment(t.segment)).toBe(true)
  })

  it.each(NEWSLETTER_TEMPLATES.map(t => [t.id, t] as const))('%s leaves the greeting to the wrapper', (_, t) => {
    // buildNewsletterPayload already opens with "Hi {first name},".
    expect(t.bodyHtml).not.toMatch(/^<p>\s*(Hi|Hello|Dear)\b/i)
  })

  it.each(NEWSLETTER_TEMPLATES.map(t => [t.id, t] as const))('%s survives the send-time sanitizer unchanged', (_, t) => {
    expect(sanitizeNewsletter(t.bodyHtml)).toBe(t.bodyHtml)
  })

  it('the never-attended template starts with the warmer batch', () => {
    const t = NEWSLETTER_TEMPLATES.find(x => x.id === 'first-event-seat')!
    expect(t.subject).toBe('Can I save you a seat?')
    expect(t.segment).toBe('never_attended_new')
  })

  it('loading a template only fills the composer: it never sends', () => {
    const src = readFileSync('app/admin/newsletter/page.tsx', 'utf8')
    const fn = src.slice(src.indexOf('async function loadTemplate'), src.indexOf('async function cancelScheduled'))
    expect(fn).toMatch(/handleDuplicate\(t\.subject, t\.bodyHtml, t\.segment\)/)
    expect(fn).not.toMatch(/fetch\(/)
  })
})
