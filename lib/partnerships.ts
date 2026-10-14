// Admin partnership records (model Partnership). One validator for create and
// update so the API can never store a value the admin page cannot show.
// Nothing in this file sends anything: a stage is a note about where the
// conversation stands, not a trigger.

import { isSafeHref } from './safeUrl'
import { KNOWN_CURRENCIES } from './data'

export const STAGES = [
  { value: 'research',            label: 'Research' },
  { value: 'email_ready',         label: 'Email Ready' },
  { value: 'email_sent',          label: 'Email Sent' },
  { value: 'waiting_reply',       label: 'Waiting Reply' },
  { value: 'follow_up_needed',    label: 'Follow-up Needed' },
  { value: 'replied',             label: 'Replied' },
  { value: 'meeting_planned',     label: 'Meeting Planned' },
  { value: 'collaboration_agreed', label: 'Collaboration Agreed' },
  { value: 'active_partner',      label: 'Active Partner' },
  { value: 'closed',              label: 'Not Relevant / Closed' },
] as const

export const PARTNERSHIP_TYPES = [
  { value: 'promote_event',      label: 'Promote an event' },
  { value: 'monthly_partner',    label: 'Monthly partner' },
  { value: 'sponsor_experience', label: 'Sponsor a Smileys experience' },
  { value: 'editorial',          label: 'Editorial / coverage' },
  { value: 'member_offer',       label: 'Member offer' },
  { value: 'other',              label: 'Other' },
] as const

export const COMMISSION_TYPES = [
  { value: 'percentage',       label: 'Percentage' },
  { value: 'amount_per_ticket', label: 'Amount per eligible ticket' },
] as const

export const PAYMENT_STATUSES = [
  { value: 'none',      label: 'Nothing due' },
  { value: 'pending',   label: 'Pending' },
  { value: 'invoiced',  label: 'Invoiced' },
  { value: 'part_paid', label: 'Partly paid' },
  { value: 'paid',      label: 'Paid' },
  { value: 'overdue',   label: 'Overdue' },
] as const

const values = (list: readonly { value: string }[]) => list.map(x => x.value)
export const STAGE_VALUES = values(STAGES)

type Data = Record<string, string | number | null>
export type PartnershipInput = { ok: true; data: Data } | { ok: false; error: string }

const TEXT_MAX: Record<string, number> = {
  organizer: 160, contactName: 120, contactEmail: 200, website: 300, campaignName: 160,
  deliverables: 2000, commissionBasis: 1000, reportingTerms: 1000, paymentTerms: 1000, internalNotes: 4000,
  eventId: 40, postId: 40, leadId: 40, sourceTag: 40,
}
/** A channel tag: lowercase letters, digits, - and _ only. */
export const SOURCE_TAG_RE = /^[a-z0-9_-]{1,40}$/
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))

/**
 * `partial` = PATCH: only the keys present are validated and returned.
 * Otherwise (create) `organizer` is required.
 * A key set to null or '' clears an optional field.
 */
export function validatePartnershipInput(raw: unknown, partial: boolean): PartnershipInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Invalid request' }
  const b = raw as Record<string, unknown>
  const out: Data = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined

  for (const k of Object.keys(TEXT_MAX)) {
    if (!has(k)) continue
    const v = b[k]
    if (v === null || v === '') {
      if (k === 'organizer') return { ok: false, error: 'Organizer is required.' }
      out[k] = null; continue
    }
    if (typeof v !== 'string') return { ok: false, error: `${k} must be text.` }
    const t = v.trim().slice(0, TEXT_MAX[k])
    if (!t) {
      if (k === 'organizer') return { ok: false, error: 'Organizer is required.' }
      out[k] = null; continue
    }
    out[k] = t
  }
  if (!partial && !out.organizer) return { ok: false, error: 'Organizer is required.' }

  if (typeof out.sourceTag === 'string' && !SOURCE_TAG_RE.test(out.sourceTag)) return { ok: false, error: 'Source tag may only use lowercase letters, numbers, - and _.' }
  if (typeof out.contactEmail === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.contactEmail)) return { ok: false, error: 'Contact email is not valid.' }
  if (typeof out.website === 'string' && (!/^https:\/\//i.test(out.website) || !isSafeHref(out.website))) return { ok: false, error: 'Website must be a full link starting with https://' }

  const pick = (k: string, list: readonly { value: string }[], label: string, nullable: boolean) => {
    if (!has(k)) return null
    const v = b[k]
    if ((v === null || v === '') && nullable) { out[k] = null; return null }
    if (typeof v !== 'string' || !values(list).includes(v)) return `${label} is not a valid choice.`
    out[k] = v; return null
  }
  const errs = [
    pick('stage', STAGES, 'Stage', false),
    pick('type', PARTNERSHIP_TYPES, 'Partnership type', true),
    pick('commissionType', COMMISSION_TYPES, 'Commission type', true),
    pick('paymentStatus', PAYMENT_STATUSES, 'Payment status', false),
  ].filter(Boolean)
  if (errs.length) return { ok: false, error: errs[0]! }

  for (const k of ['startDate', 'endDate', 'followUpDate']) {
    if (!has(k)) continue
    const v = b[k]
    if (v === null || v === '') { out[k] = null; continue }
    if (typeof v !== 'string' || !isDay(v)) return { ok: false, error: `${k} must be a date (YYYY-MM-DD).` }
    out[k] = v
  }
  const sd = (out.startDate ?? undefined) as string | undefined, ed = (out.endDate ?? undefined) as string | undefined
  if (sd && ed && ed < sd) return { ok: false, error: 'End date is before the start date.' }

  for (const k of ['feeCurrency', 'commissionCurrency']) {
    if (!has(k)) continue
    const v = b[k]
    if ((v === null || v === '') && k === 'commissionCurrency') { out[k] = null; continue }
    if (typeof v !== 'string' || !KNOWN_CURRENCIES.includes(v)) return { ok: false, error: `${k} is not a supported currency.` }
    out[k] = v
  }
  for (const k of ['feeAmount', 'commissionRate']) {
    if (!has(k)) continue
    const v = b[k]
    if (v === null || v === '') { out[k] = null; continue }
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return { ok: false, error: `${k} must be a number of zero or more.` }
    out[k] = Math.round(v * 100) / 100
  }
  if (out.commissionType === 'percentage' && typeof out.commissionRate === 'number' && out.commissionRate > 100) {
    return { ok: false, error: 'A percentage commission cannot exceed 100.' }
  }
  return { ok: true, data: out }
}
