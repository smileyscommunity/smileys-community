import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

// Funnel brief item 23 (2026-10-02): the steps that were missing from
// visitor → city → event → Join → application → approval → RSVP → attendance.
// The components and routes need a browser / DB, so the wiring is pinned
// against the source (the publicPageGuestPrivacy approach).

const read = (p: string) => readFileSync(p, 'utf-8')

describe('client funnel events', () => {
  it('every /apply link is counted by one delegated listener, mounted site-wide', () => {
    const t = read('components/JoinClickTracker.tsx')
    expect(t).toMatch(/track\('join_cta_click'/)
    expect(t).toMatch(/\^\\\/app\\\/apply\\\/\?\$/)
    expect(t).toMatch(/document\.addEventListener\('click', onClick, true\)/)
    expect(read('components/ClientOnlyComponents.tsx')).toMatch(/<JoinClickTracker \/>/)
  })

  it('the event page records a view for guests and members, including direct and shared arrivals', () => {
    expect(read('components/EventPageTracker.tsx')).toMatch(/track\('event_page_view'/)
    const page = read('app/events/[id]/page.tsx')
    expect(page).toMatch(/<EventPageTracker[^>]*audience="guest"/)
    expect(page).toMatch(/<EventPageTracker[^>]*audience="member"/)
    // Tracks the host only, never a full referrer URL
    expect(read('components/EventPageTracker.tsx')).toMatch(/\.hostname/)
    expect(read('components/EventPageTracker.tsx')).not.toMatch(/referrer\b[^;]*\bURL:/)
  })

  it('event sharing reports method and event, same event name as the other share buttons', () => {
    const s = read('components/ShareButton.tsx')
    for (const m of ['whatsapp', 'facebook', 'x', 'copy']) expect(s).toContain(`trackShare('${m}')`)
    expect(s).toMatch(/track\('share_click'/)
    expect(read('components/EventInviteButton.tsx')).toMatch(/track\('share_click', \{ method: 'native', context: 'event_invite'/)
    expect(read('app/events/[id]/page.tsx')).toMatch(/<ShareButton\s+eventId=\{id\}/)
  })

  it('the application reports start (first edit) and abandon (pagehide only), with no answers', () => {
    const a = read('app/apply/ApplyClient.tsx')
    expect(a).toMatch(/posthog\.capture\('application_started', \{ target_city: targetCitySlug, step_index: step \}\)/)
    expect(a).toMatch(/addEventListener\('pagehide', onLeave\)/)
    expect(a).toMatch(/posthog\.capture\('application_abandoned', \{ step_index: st, step_name: STEPS\[st\], target_city: city \}\)/)
    expect(a).not.toMatch(/visibilitychange/)
  })
})

describe('server funnel events', () => {
  it('trackServerForUser applies the staff filter to the subject, not the actor', () => {
    const s = read('lib/posthog-server.ts')
    expect(s).toMatch(/export async function trackServerForUser/)
    expect(s).toMatch(/u\?\.role !== 'member'\) return/)
    expect(s).toMatch(/catch \{ \/\* best-effort \*\/ \}/)
  })

  it('approval is tracked for the applicant, once per account', () => {
    const r = read('app/api/admin/applications/route.ts')
    expect(r).toMatch(/trackServerForUser\(userId, 'application_approved'/)
    expect(r).toMatch(/hours_to_decision/)
    // fresh account + pending-account approval, nothing on the retry branch
    expect(r.match(/trackApproved\(/g)?.length).toBe(2) // the two call sites
  })

  it('first attendance is tracked on check-in, deduped per member and event, never on a late replay', () => {
    const r = read('app/api/events/[id]/checkin/route.ts')
    expect(r).toMatch(/checkedIn && !lateReplay && await claimOnce\(`track:checkin:\$\{eventId\}:\$\{userId\}`/)
    expect(r).toMatch(/'event_checked_in'/)
    expect(r).toMatch(/is_first: earlier === 0/)
  })

  it('a host-promoted waitlister is tracked', () => {
    expect(read('app/api/admin/events/[id]/participants/route.ts')).toMatch(/trackServerForUser\(next\.userId, 'waitlist_promoted'/)
  })

  it('no event payload carries personal details', () => {
    for (const f of ['components/JoinClickTracker.tsx', 'components/EventPageTracker.tsx', 'lib/posthog-server.ts'])
      expect(read(f)).not.toMatch(/\b(email|phone|fullName|nationality|birthdate)\b\s*[:,]/)
  })
})

describe('Core Web Vitals reporting', () => {
  it('sends each vital as a consent-gated web_vital event with a coarse device bucket and no query string', () => {
    const c = read('components/WebVitalsReporter.tsx')
    expect(c).toMatch(/useReportWebVitals/)
    expect(c).toMatch(/track\('web_vital'/)
    expect(c).toMatch(/window\.location\.pathname/)
    expect(c).not.toMatch(/location\.(search|href)/)
    expect(read('components/ClientOnlyComponents.tsx')).toMatch(/<WebVitalsReporter \/>/)
  })
})
