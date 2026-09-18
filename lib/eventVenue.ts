import { prisma } from '@/lib/prisma'

// ── An event's directory listing ────────────────────────────────────────────
//
// Event.businessId is the link; the organiser picks the listing in the event
// form (components/VenuePicker). It used to be the venue NAME, re-matched on
// every read by the event page, the listing page, the survey, the dashboard
// prompt and the review-nudge sweep — each with its own normaliser, one of
// them with an alias map — and a spelling drift dropped the link everywhere.
//
// A link may point at a pending or hidden listing (a stub made from the event,
// awaiting review); only a live one is ever shown.

/** What "live" means for a listing — the directory page's own rule. */
export const LIVE_BUSINESS = { isApproved: true, isActive: true } as const

/**
 * The businessId an event write asked for, checked: a listing in the event's
 * own city. `undefined` = the body didn't say (leave it / match by name);
 * `null` = no listing.
 */
export async function venueIdInput(v: unknown, cityId: string): Promise<{ value: string | null | undefined } | { error: string }> {
  if (v === undefined) return { value: undefined }
  if (v === null || v === '') return { value: null }
  if (typeof v !== 'string' || v.length > 64) return { error: 'Invalid directory venue' }
  const biz = await prisma.business.findFirst({ where: { id: v, cityId, isActive: true }, select: { id: true } })
  // A listing from another city would put this event on that city's page.
  if (!biz) return { error: 'That directory venue isn\'t listed in this event\'s city' }
  return { value: biz.id }
}

/** The event's listing when it is live, else null. */
export async function liveVenueOf(businessId: string | null | undefined) {
  if (!businessId) return null
  return prisma.business.findFirst({
    where:  { id: businessId, ...LIVE_BUSINESS },
    select: { id: true, name: true, claimedById: true },
  })
}
