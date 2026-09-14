import { confirmToast } from '@/lib/confirmToast'

// ── Seating past an event's capacity, on purpose ────────────────────────────
//
// The production audit found 13 limited events with more approved seats than
// spots: staff approve / add / promote never looked at the cap, and an edit
// could lower totalSpots under the people already seated. The server now
// refuses those (lib/eventCapacity) unless the request carries
// `allowOverCapacity: true` — and the staff pages send that flag only after
// the person pressing the button has said yes to "This will exceed capacity".
// One rule for every staff door: refuse, ask, then override explicitly.
//
// Client-safe (no prisma): the codes are shared with the server so the page
// recognises a capacity refusal rather than any 400/409.

export const OVER_CAPACITY_CODE  = 'over_capacity'
export const BELOW_APPROVED_CODE = 'below_approved_seats'
export const OVERRIDE_FLAG       = 'allowOverCapacity'

export interface CapacityRefusal {
  code:       typeof OVER_CAPACITY_CODE | typeof BELOW_APPROVED_CODE
  approved:   number
  totalSpots: number
  error:      string
}

/** The refusal carried by a response, or null when it isn't one. Reads a clone, so the caller can still read the body. */
export async function capacityRefusal(res: Response): Promise<CapacityRefusal | null> {
  if (res.status !== 409 && res.status !== 400) return null
  const d = await res.clone().json().catch(() => null)
  if (d?.code !== OVER_CAPACITY_CODE && d?.code !== BELOW_APPROVED_CODE) return null
  return { code: d.code, approved: Number(d.approved) || 0, totalSpots: Number(d.totalSpots) || 0, error: String(d.error ?? '') }
}

export function capacityQuestion(r: CapacityRefusal): string {
  return r.code === BELOW_APPROVED_CODE
    ? `This will exceed capacity — ${r.approved} member${r.approved === 1 ? ' already holds a seat' : 's already hold seats'}, more than the ${r.totalSpots} you're setting. Nobody is removed; new RSVPs stay closed until seats free up. Save anyway?`
    : `This will exceed capacity — ${r.approved} of ${r.totalSpots} seats are already taken. Seat them anyway?`
}

function askToExceed(r: CapacityRefusal): Promise<boolean> {
  return confirmToast(capacityQuestion(r), { confirmLabel: 'Exceed capacity', cancelLabel: 'Keep the cap' })
}

/**
 * Send once; on a capacity refusal ask, and resend with the override only on
 * a yes. Resolves null when the answer was no — nothing changed, nothing to
 * report.
 */
export async function withCapacityConfirm(send: (allowOverCapacity: boolean) => Promise<Response>): Promise<Response | null> {
  const res = await send(false)
  const refusal = await capacityRefusal(res)
  if (!refusal) return res
  if (!(await askToExceed(refusal))) return null
  return send(true)
}

/**
 * The batch form ("Approve all", "Promote N"): one question for the whole
 * run, asked at the first refusal. A no leaves that request refused — and
 * every later one — so the summary toast counts them as not seated.
 */
export function capacityConfirmForBatch() {
  let decision: boolean | null = null
  return async (send: (allowOverCapacity: boolean) => Promise<Response>): Promise<Response> => {
    const res = await send(decision === true)
    const refusal = await capacityRefusal(res)
    if (!refusal || decision !== null) return res
    decision = await askToExceed(refusal)
    return decision ? send(true) : res
  }
}

export type BatchCapacityConfirm = ReturnType<typeof capacityConfirmForBatch>

/**
 * The cross-event batch (the participants inbox approves requests for many
 * events in one click). One answer for the whole run carried event A's
 * "3 of 10 seats" yes into event B — seating B over its cap without anyone
 * seeing B's numbers — and turned a no for A into silent failures for B.
 * So one batch confirm per event: each event's first refusal asks with that
 * event's counts, later refusals for the same event reuse its answer.
 */
export function capacityConfirmPerEvent() {
  const byEvent = new Map<string, BatchCapacityConfirm>()
  return {
    forEvent(eventId: string): BatchCapacityConfirm {
      let confirm = byEvent.get(eventId)
      if (!confirm) { confirm = capacityConfirmForBatch(); byEvent.set(eventId, confirm) }
      return confirm
    },
  }
}

/**
 * A batch response that is still an over_capacity refusal means the person
 * pressed "Keep the cap" — the request stays where it was by choice, so the
 * summary counts it as held at capacity, not as a failure.
 */
export async function leftAtCapacity(res: Response): Promise<boolean> {
  return (await capacityRefusal(res))?.code === OVER_CAPACITY_CODE
}
