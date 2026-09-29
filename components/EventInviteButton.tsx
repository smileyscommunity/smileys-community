'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface Props {
  eventId: string
  eventTitle: string
  userId: string
}

export default function EventInviteButton({ eventId, eventTitle, userId }: Props) {
  const [copied, setCopied] = useState(false)

  const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/app/events/${eventId}?ref=${userId}`
  const shareText = `Join me at "${eventTitle}" on Smileys Community! ${inviteUrl}`

  async function handleInvite() {
    if (navigator.share) {
      try {
        await navigator.share({ title: eventTitle, text: `Join me at this event!`, url: inviteUrl })
        return
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      toast.success('Invite link copied!')
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast.error('Could not copy link')
    }
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
      <span className="text-2xl shrink-0">🤝</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900">Bring a friend</p>
        <p className="text-xs text-amber-700 mt-0.5">Share your personal invite link</p>
      </div>
      <button
        onClick={handleInvite}
        className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-colors"
      >
        {copied ? (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
            Invite
          </>
        )}
      </button>
    </div>
  )
}
