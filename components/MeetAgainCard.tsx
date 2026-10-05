'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// Dashboard prompt for "Would you meet them again?" (lib/meetAgain). The
// server decides whether there is anything to ask (meetAgainPendingFor); this
// only remembers, per device, that the member already opened or waved it off.

interface Props { event: { id: string; title: string; emoji: string; people: number } }

const KEY = 'dismissed_meet_again'

function read(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
function remember(id: string): void {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set([...read(), id])].slice(-20))) } catch {}
}

export default function MeetAgainCard({ event }: Props) {
  const [hidden, setHidden] = useState(true)
  useEffect(() => { setHidden(read().includes(event.id)) }, [event.id])
  if (hidden) return null

  const dismiss = () => { remember(event.id); setHidden(true) }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-2xl shrink-0" aria-hidden="true">
          {event.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base leading-tight text-gray-900">Anyone from {event.title} you&rsquo;d meet again?</h3>
          <p className="text-xs text-gray-600 mt-1">
            Pick quietly. Nobody sees your picks, and if it&rsquo;s mutual you&rsquo;re connected.
          </p>
          <div className="flex items-center gap-3 mt-4">
            <Link
              href={`/events/${event.id}#meet-again`}
              onClick={() => remember(event.id)}
              className="px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition-colors"
            >
              Choose
            </Link>
            <button onClick={dismiss} className="text-xs text-gray-500 hover:text-gray-800 font-medium px-2 py-1">
              Not this time
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
