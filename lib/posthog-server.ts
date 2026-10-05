import { PostHog } from 'posthog-node'
import { prisma } from '@/lib/prisma'

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

// For an event ABOUT a member that someone else caused — staff approving an
// application, a host's door tap, a promotion off the waitlist. trackServer
// takes the actor, and the actor there is staff (skipped) or the host, so the
// member's own funnel step would never be recorded. This looks the subject's
// role up and applies the same staff filter to THEM. Best-effort: analytics
// must never fail the request that triggered it.
export async function trackServerForUser(
  userId: string,
  event: string,
  properties: Record<string, unknown> = {},
) {
  try {
    const client = getPostHogClient()
    if (!client) return
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (u?.role !== 'member') return
    client.capture({ distinctId: userId, event, properties })
  } catch { /* best-effort */ }
}
