import Link from 'next/link'

interface Props {
  hasProfilePhoto: boolean
  hasBio:          boolean
  hasNeighborhood: boolean
  interestCount:   number
  clubCount:       number
  attendedCount:   number
}

// Single source of truth for the dashboard's onboarding nudge. Used to
// live as an inline IIFE in the right rail; extracting it lets us also
// render it on mobile (where the right rail is hidden) without
// duplicating the steps logic. Renders `null` when all steps are done,
// so the caller can drop it in unconditionally.
export default function GetStartedChecklist(props: Props) {
  const steps = [
    { label: 'Add a profile photo',  done: props.hasProfilePhoto,    href: '/profile' },
    { label: 'Write a short bio',     done: props.hasBio,             href: '/profile' },
    { label: 'Set your neighborhood', done: props.hasNeighborhood,    href: '/profile' },
    { label: 'Pick your interests',   done: props.interestCount > 0,  href: '/profile' },
    { label: 'Join a club',           done: props.clubCount    > 0,   href: '/clubs'   },
    { label: 'RSVP to an event',      done: props.attendedCount > 0,  href: '/events'  },
  ]
  const doneCount = steps.filter(s => s.done).length
  if (doneCount === steps.length) return null
  const pct = Math.round((doneCount / steps.length) * 100)

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-bold text-gray-900">Get started</h2>
        <span className="text-xs font-semibold text-amber-600">{doneCount}/{steps.length}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full mb-4 overflow-hidden">
        <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="space-y-2">
        {steps.map(step => (
          <Link
            key={step.label}
            href={step.href}
            className={`flex items-center gap-2.5 text-sm transition-colors ${step.done ? 'text-gray-400 line-through pointer-events-none' : 'text-gray-700 hover:text-amber-600'}`}
          >
            <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${step.done ? 'border-green-400 bg-green-400' : 'border-gray-300'}`}>
              {step.done && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            {step.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
