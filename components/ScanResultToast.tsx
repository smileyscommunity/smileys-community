import type { ScanResult } from '@/lib/checkin'

// Maps each scan-result type to a color, icon, and the user-facing
// copy. Centralised here so the message wording can't drift between
// /admin/checkin and /host/checkin — used to be inline strings on both
// pages and the host page's "X — already checked in" sat next to the
// admin page's "X already checked in" because no shared source.
const TYPE_STYLE: Record<ScanResult['type'], { cls: string; icon: string }> = {
  success:  { cls: 'bg-green-500 text-white', icon: '✓' },
  already:  { cls: 'bg-amber-500 text-white', icon: '↩' },
  notfound: { cls: 'bg-red-500 text-white',   icon: '✕' },
  invalid:  { cls: 'bg-red-500 text-white',   icon: '✕' },
  error:    { cls: 'bg-red-500 text-white',   icon: '✕' },
}

function copy(r: ScanResult): string {
  if (r.type === 'success')  return `${r.name} checked in!`
  if (r.type === 'already')  return `${r.name} already checked in`
  if (r.type === 'notfound') return 'Not registered for this event'
  if (r.type === 'invalid')  return 'Invalid QR code'
  return r.name ? `Check-in failed for ${r.name}` : 'Check-in failed'
}

/**
 * Single-style toast for both check-in pages. The host page used a
 * full-width banner at the top, the admin page used a centered pill
 * at the bottom — same content, two different presentations. Now both
 * use the pill; `position` picks top or bottom.
 */
export default function ScanResultToast({
  result,
  position = 'bottom',
}: {
  result:    ScanResult | null
  position?: 'top' | 'bottom'
}) {
  if (!result) return null
  const style = TYPE_STYLE[result.type]
  const positionCls = position === 'top'
    ? 'top-4 left-1/2 -translate-x-1/2'
    : 'bottom-6 left-1/2 -translate-x-1/2'
  return (
    <div
      className={`fixed z-50 px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold flex items-center gap-2 ${style.cls} ${positionCls}`}
      role="status"
      aria-live="polite"
    >
      <span>{style.icon}</span>
      <span>{copy(result)}</span>
    </div>
  )
}
