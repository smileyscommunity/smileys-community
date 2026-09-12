import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

// The hourly reminders cron. createNotification sends the push itself and
// honours the "reminders" mute, so the explicit sendPushToUser that
// followed doubled every reminder — and, for a muted member (no row
// written, so never deduped), fired again on every tick in the window.
// Review requests were keyed per member for life and emailed muted
// members hourly for the same reason.
const src = readFileSync('app/api/admin/cron/reminders/route.ts', 'utf-8')

describe('reminders cron', () => {
  it('never pushes on its own', () => {
    expect(src).not.toContain('sendPushToUser')
  })
  it('asks for a review once per event, not once per member', () => {
    expect(src).toMatch(/const reviewLinkFor = \(eventId: string\) => `\/reviews\?event=\$\{eventId\}`/)
    expect(src).toMatch(/const key = `\$\{userId\}:\$\{reviewLinkFor\(event\.id\)\}`/)
    expect(src).not.toMatch(/`\$\{userId\}:\/reviews`/)
  })
  it('skips members who muted reminders before the email, not only the bell', () => {
    expect(src).toMatch(/notificationPreference\.findMany\(\{\s*where:\s*\{ userId: \{ in: pastAttendeeIds \}, reminders: false \}/)
    expect(src).toMatch(/if \(reviewsMuted\.has\(userId\)\) continue/)
  })
})
