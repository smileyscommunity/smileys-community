// ── Relative timestamps, one home ───────────────────────────────────────────
// timeAgo existed as ~23 local copies with FOUR different behaviors — most
// visibly, the notification bell capped at "12d ago" while the notifications
// page cut over to "3 Aug" after a week, so the same notification carried two
// different timestamps depending on where you looked. New call sites import
// one of these; the remaining local copies migrate as their files are touched.

/** "just now" · "5m ago" · "3h ago" · "6d ago", then a dated cutover ("3 Aug", with year when older). */
export function timeAgo(iso: string | Date, opts: { cutoverDays?: number } = {}): string {
  const cutover = opts.cutoverDays ?? 7
  const then = new Date(iso)
  const diff = Date.now() - then.getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < cutover) return `${d}d ago`
  const sameYear = then.getFullYear() === new Date().getFullYear()
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}
