import Link from 'next/link'

// "What needs attention" pill row, shared between /admin and /admin/moderator
// so the surface looks identical regardless of which dashboard the staff
// member landed on. Each page builds its own array from its own data source
// (admin sees pending apps + payments + reports + visitors; mod sees apps +
// reports + visitors) and hands it off.

export interface Alert {
  icon:  string
  label: string
  // Omit for a monitoring signal with no in-app drill-down (email/cron
  // health — the fix lives in Resend or the server crontab, not a page).
  // Such alerts render as a non-clickable status pill, no chevron, so the
  // UI doesn't promise a destination that isn't there.
  href?: string
  /**
   * Tailwind class string for border + bg + text color.
   * e.g. 'border-amber-500/30 bg-amber-500/5 text-amber-400'
   */
  color: string
}

interface Props {
  alerts: Alert[]
}

export default function AlertsRow({ alerts }: Props) {
  if (alerts.length === 0) return null
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {alerts.map((a, i) => a.href ? (
        <Link key={i} href={a.href}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-sm font-semibold hover:opacity-80 transition-opacity ${a.color}`}>
          <span className="text-base shrink-0">{a.icon}</span>
          <span>{a.label}</span>
          <svg className="w-3.5 h-3.5 ml-auto opacity-60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ) : (
        <div key={i}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-sm font-semibold ${a.color}`}>
          <span className="text-base shrink-0">{a.icon}</span>
          <span>{a.label}</span>
        </div>
      ))}
    </div>
  )
}
