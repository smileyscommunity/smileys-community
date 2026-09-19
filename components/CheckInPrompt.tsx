'use client'

import Link from 'next/link'
import { type CheckInPromptEvent } from '@/lib/checkInPrompt'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { awaitingCheckInPerEvent } from '@/lib/hostPanel'

// The host-facing prompt itself. The rule for which events land here — and
// why they land here at all — lives in lib/checkInPrompt, next to the policy
// it mirrors and where the tests can reach it.

// `tz` is only the fallback: each event's deadline runs on its own city's
// clock when the list carries it (/api/host/events sends `timezone`).
export default function CheckInPrompt({
  events, tz = DEFAULT_TZ,
}: { events: (CheckInPromptEvent & { timezone?: string | null })[]; tz?: string }) {
  const pending = awaitingCheckInPerEvent(events, tz)
  if (pending.length === 0) return null

  return (
    <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-2xl shrink-0">📋</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white">
            {pending.length === 1
              ? 'One event still needs its check-in'
              : `${pending.length} events still need their check-in`}
          </h3>
          {/* The settle rule (lib/standing settleAttendance): an unmarked guest
              becomes a no-show only if they were told they weren't checked in
              and didn't answer; one who never got that notice is recorded as
              attended. Said plainly, because "recorded as attended" alone
              read as "nothing can go wrong". */}
          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
            At midnight the day after the event, anyone you haven&apos;t marked is
            settled: guests we told they weren&apos;t checked in, who didn&apos;t
            reply, become no-shows; anyone who never got that message is recorded
            as attended. Check people in, and mark who didn&apos;t come, before then.
          </p>

          <div className="mt-4 space-y-2">
            {pending.map(({ event: e, approved, checked, hoursLeft }) => (
              <Link
                key={e.id}
                href={`/host/checkin?event=${e.id}`}
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3 hover:border-amber-500/50 transition-colors group"
              >
                <span aria-hidden="true" className="text-xl shrink-0">{e.emoji}</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate group-hover:text-amber-400 transition-colors">
                    {e.title}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {e.date} · {checked} of {approved} checked in
                  </div>
                </div>
                <div className="ml-auto text-right shrink-0">
                  <div className={`text-xs font-semibold ${hoursLeft <= 6 ? 'text-red-400' : 'text-amber-400'}`}>
                    {hoursLeft}h left
                  </div>
                  <div className="text-[11px] text-zinc-500">Check in →</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
