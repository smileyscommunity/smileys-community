import { PostHog } from 'posthog-node'

// Module-level singleton — the previous per-request `new PostHog()` + `await
// posthog.shutdown()` pattern killed batching on a long-running PM2 server and
// added a synchronous PostHog HTTP roundtrip to every captured request. With one
// instance, posthog-node batches events on its default 10s/20-event flush.
let cached: PostHog | null | undefined

export function getPostHogClient(): PostHog | null {
  if (cached !== undefined) return cached
  const key = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  if (!key) {
    cached = null
    return null
  }
  cached = new PostHog(key, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST })
  return cached
}

// Skip admin/moderator actions so staff dogfooding doesn't pollute member
// funnels. Also no-ops if PostHog isn't configured.
export function trackServer(
  user: { id: string; role: string },
  event: string,
  properties: Record<string, unknown> = {},
) {
  if (user.role !== 'member') return
  getPostHogClient()?.capture({ distinctId: user.id, event, properties })
}
