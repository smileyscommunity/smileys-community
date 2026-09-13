// What an event form should say when a location lookup is refused, or null
// when the lookup ran (judge it by its results).
//
// The four event forms read any non-array body as "No location found", so a
// host refused with a 403 (the route used to be admin-only) or throttled with
// a 429 was told their real address didn't exist. Plain .ts so it can be
// unit-tested — vitest can't import the .tsx forms.
export function geocodeFailureMessage(status: number): string | null {
  if (status >= 200 && status < 300) return null
  if (status === 401) return 'Your session has expired — sign in again to look up locations'
  if (status === 403) return "Your account can't use location lookup — paste a Google Maps link instead"
  if (status === 429) return 'Too many location lookups — wait a few minutes and try again'
  return `Location lookup failed (${status}) — paste a Google Maps link instead`
}
