'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Props {
  text:       string
  link?:      string
  updatedAt?: string | null
}

const LS_KEY = 'smileys_announcement_dismissed'

export default function AnnouncementBanner({ text, link, updatedAt }: Props) {
  // null until the dismissed check has run. The banner used to render on the
  // server and then vanish on mount for everyone who had already closed it —
  // which on a phone is most readers, and the whole center column jumped up
  // under their thumb. Now it only ever appears, never appears-then-goes.
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  // On mount, check if this exact announcement version was already dismissed.
  // Key on updatedAt so a new announcement always shows even if a prior one was dismissed.
  useEffect(() => {
    let stored: string | null = null
    try { stored = localStorage.getItem(LS_KEY) } catch { /* localStorage unavailable */ }
    setDismissed(!!stored && stored === (updatedAt ?? text))
  }, [updatedAt, text])

  function dismiss() {
    try { localStorage.setItem(LS_KEY, updatedAt ?? text) } catch { /* ignore */ }
    setDismissed(true)
  }

  if (dismissed !== false || !text) return null

  const content = (
    <div className="flex items-start gap-2 flex-1 min-w-0">
      <span className="text-sm shrink-0">📢</span>
      <p className="text-xs font-medium text-amber-900 leading-snug">{text}</p>
    </div>
  )

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 flex items-start gap-2">
      {link ? (
        <Link href={link} className="flex-1 min-w-0 hover:opacity-80 transition-opacity">
          {content}
        </Link>
      ) : (
        <div className="flex-1 min-w-0">{content}</div>
      )}
      <button onClick={dismiss} aria-label="Dismiss announcement"
        className="shrink-0 text-amber-400 hover:text-amber-600 transition-colors text-base leading-none p-2 -m-1.5">
        ×
      </button>
    </div>
  )
}
