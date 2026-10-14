// Optional read of ticket-link clicks from PostHog for one article.
// Needs POSTHOG_PERSONAL_API_KEY (a read-only personal API key) and
// POSTHOG_PROJECT_ID; without them it returns null and the report says
// "not connected" instead of guessing. Counts events named event_ticket_click
// — clicks on the public ticket link, never sales. Best-effort, 5s budget.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,200}$/

export function posthogApiHost(ingestHost = process.env.NEXT_PUBLIC_POSTHOG_HOST): string {
  // The capture host (eu.i.posthog.com) is not the API host (eu.posthog.com).
  return (ingestHost || 'https://eu.i.posthog.com').replace(/\/$/, '').replace('.i.posthog.com', '.posthog.com')
}

export async function ticketClicksFor(slug: string): Promise<number | null> {
  const key = process.env.POSTHOG_PERSONAL_API_KEY, project = process.env.POSTHOG_PROJECT_ID
  if (!key || !project || !/^\d+$/.test(project) || !SLUG_RE.test(slug)) return null
  try {
    const res = await fetch(`${posthogApiHost()}/api/projects/${project}/query/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: `SELECT count() FROM events WHERE event = 'event_ticket_click' AND properties.article_slug = '${slug}'` } }),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const n = (await res.json())?.results?.[0]?.[0]
    return typeof n === 'number' && Number.isFinite(n) ? n : null
  } catch { return null }
}
