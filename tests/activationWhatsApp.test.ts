import { describe, it, expect } from 'vitest'
import { activationWhatsAppMessage, activationWhatsAppUrl, approvedWhen } from '@/lib/activationWhatsApp'

const LINK = 'https://smileyscommunity.com/app/activate?token=abc123'
const NOW  = new Date('2026-10-13T10:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

describe('approvedWhen', () => {
  it('keeps it vague for a recent approval', () => {
    expect(approvedWhen(daysAgo(3), NOW)).toBe('a little while ago')
    expect(approvedWhen(daysAgo(60), NOW)).toBe('a little while ago')
  })

  it('names the month once "a little while" would undersell it', () => {
    expect(approvedWhen(new Date('2026-06-20T12:00:00Z'), NOW)).toBe('back in June')
    expect(approvedWhen(new Date('2026-05-08T12:00:00Z'), NOW)).toBe('back in May')
  })

  it('adds the year when it is a different one', () => {
    expect(approvedWhen(new Date('2025-12-10T12:00:00Z'), NOW)).toBe('back in December 2025')
  })

  it("reads the month in Istanbul's day, not UTC's", () => {
    // 22:30 UTC on 31 July is already 1 August in Istanbul (UTC+3).
    expect(approvedWhen(new Date('2026-07-31T22:30:00Z'), NOW)).toBe('back in August')
  })

  it("uses the member's city timezone when given one", () => {
    expect(approvedWhen(new Date('2026-07-31T22:30:00Z'), NOW, 'UTC')).toBe('back in July')
  })
})

describe('activationWhatsAppMessage', () => {
  it('greets by first name and carries the link', () => {
    const msg = activationWhatsAppMessage('Ayşe', LINK, daysAgo(5), NOW)
    expect(msg.startsWith("Hi Ayşe, it's Nate from Smileys")).toBe(true)
    expect(msg).toContain('You were approved a little while ago,')
    expect(msg).toContain(LINK)
    expect(msg).toContain('valid for 7 days')
  })

  it('names the month for an older approval', () => {
    const msg = activationWhatsAppMessage('Sam', LINK, new Date('2026-06-20T12:00:00Z'), NOW)
    expect(msg).toContain('You were approved back in June,')
  })

  it('falls back when there is no first name', () => {
    expect(activationWhatsAppMessage('  ', LINK, daysAgo(5), NOW).startsWith('Hi there,')).toBe(true)
    expect(activationWhatsAppMessage(null, LINK, daysAgo(5), NOW).startsWith('Hi there,')).toBe(true)
  })
})

describe('activationWhatsAppUrl', () => {
  it('opens a chat with the message filled in', () => {
    const url = activationWhatsAppUrl('+90 544 330 30 68', 'Turkey', 'Hi & welcome?')
    expect(url).toBe('https://wa.me/905443303068?text=Hi%20%26%20welcome%3F')
  })

  it('keeps the activation link intact through encoding', () => {
    const msg = activationWhatsAppMessage('Sam', LINK, daysAgo(5), NOW)
    const url = activationWhatsAppUrl('+447700900123', 'British', msg)!
    expect(new URL(url).searchParams.get('text')).toBe(msg)
  })

  it('returns null without a usable number', () => {
    expect(activationWhatsAppUrl(null, 'Turkey', 'x')).toBeNull()
    expect(activationWhatsAppUrl('n/a', 'Turkey', 'x')).toBeNull()
  })
})
