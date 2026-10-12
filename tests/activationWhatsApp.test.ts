import { describe, it, expect } from 'vitest'
import { activationWhatsAppMessage, activationWhatsAppUrl } from '@/lib/activationWhatsApp'

const LINK = 'https://smileyscommunity.com/app/activate?token=abc123'

describe('activationWhatsAppMessage', () => {
  it('greets by first name and carries the link', () => {
    const msg = activationWhatsAppMessage('Ayşe', LINK)
    expect(msg.startsWith("Hi Ayşe, it's Nate from Smileys")).toBe(true)
    expect(msg).toContain(LINK)
    expect(msg).toContain('valid for 7 days')
  })

  it('falls back when there is no first name', () => {
    expect(activationWhatsAppMessage('  ', LINK).startsWith('Hi there,')).toBe(true)
    expect(activationWhatsAppMessage(null, LINK).startsWith('Hi there,')).toBe(true)
  })
})

describe('activationWhatsAppUrl', () => {
  it('opens a chat with the message filled in', () => {
    const url = activationWhatsAppUrl('+90 544 330 30 68', 'Turkey', 'Hi & welcome?')
    expect(url).toBe('https://wa.me/905443303068?text=Hi%20%26%20welcome%3F')
  })

  it('keeps the activation link intact through encoding', () => {
    const msg = activationWhatsAppMessage('Sam', LINK)
    const url = activationWhatsAppUrl('+447700900123', 'British', msg)!
    expect(new URL(url).searchParams.get('text')).toBe(msg)
  })

  it('returns null without a usable number', () => {
    expect(activationWhatsAppUrl(null, 'Turkey', 'x')).toBeNull()
    expect(activationWhatsAppUrl('n/a', 'Turkey', 'x')).toBeNull()
  })
})
