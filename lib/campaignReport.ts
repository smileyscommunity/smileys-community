// Campaign report ledger (model CampaignReportEntry) and its summary.
//
// Rules this file exists to enforce:
//  · Ticket sales and discount redemptions come ONLY from a reported figure
//    (organizer report, integration, own records) with a source and a
//    reporting date. A click, a view, an RSVP or an enquiry is never one.
//  · Fee received, commission received and expenses are separate kinds and are
//    never added together or netted into "profit": other costs are not in here,
//    so any such number would be wrong.
//  · Totals are per currency — a lira amount and a euro amount are not a sum.

import { KNOWN_CURRENCIES } from './data'
import { roundMoney } from './money'

export const COUNT_KINDS = [
  { value: 'tickets_sold',         label: 'Tickets sold' },
  { value: 'discount_redemptions', label: 'Discount redemptions' },
  { value: 'ticket_clicks',        label: 'Ticket-link clicks (manual)' },
] as const
export const MONEY_KINDS = [
  { value: 'fee_received',        label: 'Fixed fee received' },
  { value: 'commission_received', label: 'Commission received' },
  { value: 'expense',             label: 'Expense' },
] as const
export const ENTRY_KINDS = [...COUNT_KINDS, ...MONEY_KINDS]

export const REPORT_SOURCES = [
  { value: 'organizer_report', label: 'Organizer report' },
  { value: 'integration',      label: 'Ticketing integration' },
  { value: 'posthog',          label: 'PostHog' },
  { value: 'invoice_or_bank',  label: 'Invoice or bank record' },
  { value: 'own_records',      label: 'Our own records' },
] as const

const kindOf = (v: unknown) => ENTRY_KINDS.find(k => k.value === v)
const isCount = (kind: string) => COUNT_KINDS.some(k => k.value === kind)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))

export type EntryInput =
  | { ok: true; data: { kind: string; quantity: number | null; amount: number | null; currency: string | null; source: string; reportedAt: string; periodStart: string | null; periodEnd: string | null; note: string | null } }
  | { ok: false; error: string }

export function validateEntryInput(raw: unknown, today: string): EntryInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Invalid request' }
  const b = raw as Record<string, unknown>
  if (!kindOf(b.kind)) return { ok: false, error: 'Choose what is being reported.' }
  const kind = b.kind as string
  if (typeof b.source !== 'string' || !REPORT_SOURCES.some(s => s.value === b.source)) return { ok: false, error: 'Say where this figure came from.' }
  if (!isDay(b.reportedAt)) return { ok: false, error: 'The reporting date is required (YYYY-MM-DD).' }
  if (b.reportedAt > today) return { ok: false, error: 'The reporting date cannot be in the future.' }
  // A sale or redemption must be reported by someone who can know: not a click counter.
  if ((kind === 'tickets_sold' || kind === 'discount_redemptions') && b.source === 'posthog') {
    return { ok: false, error: 'PostHog counts clicks and views, not sales. Use an organizer report, integration or our own records.' }
  }
  const ps = b.periodStart == null || b.periodStart === '' ? null : b.periodStart
  const pe = b.periodEnd == null || b.periodEnd === '' ? null : b.periodEnd
  if ((ps !== null && !isDay(ps)) || (pe !== null && !isDay(pe))) return { ok: false, error: 'Period dates must be YYYY-MM-DD.' }
  if (ps && pe && pe < ps) return { ok: false, error: 'The period ends before it starts.' }
  const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 500) : null

  let quantity: number | null = null, amount: number | null = null, currency: string | null = null
  if (isCount(kind)) {
    if (typeof b.quantity !== 'number' || !Number.isInteger(b.quantity) || b.quantity < 0 || b.quantity > 10_000_000) return { ok: false, error: 'Enter a whole number of zero or more.' }
    quantity = b.quantity
  } else {
    if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount < 0) return { ok: false, error: 'Enter an amount of zero or more.' }
    if (typeof b.currency !== 'string' || !KNOWN_CURRENCIES.includes(b.currency)) return { ok: false, error: 'Choose a currency.' }
    amount = roundMoney(b.amount); currency = b.currency
  }
  return { ok: true, data: { kind, quantity, amount, currency, source: b.source as string, reportedAt: b.reportedAt, periodStart: ps, periodEnd: pe, note } }
}

export interface Entry { kind: string; quantity: number | null; amount: number | null; currency: string | null; reportedAt: string; source: string }

export interface ReportSummary {
  /** null = nobody has reported it. Never a zero standing in for "unknown". */
  ticketsSold: number | null
  discountRedemptions: number | null
  manualTicketClicks: number | null
  /** Per currency, in the currency it was received/spent in. */
  received: { currency: string; fee: number; commission: number }[]
  expenses: { currency: string; amount: number }[]
  latestReportedAt: string | null
}

export function summarize(entries: Entry[]): ReportSummary {
  const sum = (kind: string) => {
    const rows = entries.filter(e => e.kind === kind && e.quantity !== null)
    return rows.length ? rows.reduce((n, e) => n + (e.quantity as number), 0) : null
  }
  const byCur = (kinds: string[]) => {
    const m = new Map<string, Record<string, number>>()
    for (const e of entries) {
      if (!kinds.includes(e.kind) || e.amount === null || !e.currency) continue
      const row = m.get(e.currency) ?? {}
      row[e.kind] = roundMoney((row[e.kind] ?? 0) + e.amount)
      m.set(e.currency, row)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }
  return {
    ticketsSold: sum('tickets_sold'),
    discountRedemptions: sum('discount_redemptions'),
    manualTicketClicks: sum('ticket_clicks'),
    received: byCur(['fee_received', 'commission_received']).map(([currency, r]) => ({ currency, fee: r.fee_received ?? 0, commission: r.commission_received ?? 0 })),
    expenses: byCur(['expense']).map(([currency, r]) => ({ currency, amount: r.expense ?? 0 })),
    latestReportedAt: entries.map(e => e.reportedAt).sort().pop() ?? null,
  }
}
