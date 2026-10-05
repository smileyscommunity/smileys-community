// The cookie banner's answer, in one place. The banner wrote this key and
// nothing ever read it: "Essential only" changed nothing — PostHog (session
// replay included) and the fingerprint library ran for every visitor, while
// the cookies page promised analytics only "if you accept all".
//
// Browser-only. Anything that reads it must treat "no answer yet" the same
// as "essential": nothing optional runs before a yes.
export const CONSENT_KEY = 'smileys-cookie-consent'
export type Consent = 'accepted' | 'essential' | null

export function readConsent(): Consent {
  try {
    const v = typeof window === 'undefined' ? null : window.localStorage.getItem(CONSENT_KEY)
    return v === 'accepted' || v === 'essential' ? v : null
  } catch { return null }
}

export function hasAnalyticsConsent(): boolean {
  return readConsent() === 'accepted'
}
