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
  const [dismissed, setDismissed] = useState(false)

  // On mount, check if this exact announcement version was already dismissed.
  // Key on updatedAt so a new announcement always shows even if a prior one was dismissed.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY)
      if (stored && stored === (updatedAt ?? text)) setDismissed(true)
    } catch { /* localStorage unavailable */ }
  }, [updatedAt, text])

  function dismiss() {
    try { localStorage.setItem(LS_KEY, updatedAt ?? text) } catch { /* ignore */ }
    setDismissed(true)
  }

  if (dismissed || !text) return null

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
