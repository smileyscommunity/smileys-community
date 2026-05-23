'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Props {
  text: string
  link?: string
}

export default function AnnouncementBanner({ text, link }: Props) {
  const [dismissed, setDismissed] = useState(false)
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
      <button onClick={() => setDismissed(true)}
        className="shrink-0 text-amber-400 hover:text-amber-600 transition-colors text-base leading-none mt-0.5">
        ×
      </button>
    </div>
  )
}
