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
