'use client'

import { useState } from 'react'
import { toast } from 'sonner'

// In-app replacement for window.prompt() — same rationale as confirmToast:
// native dialogs are suppressed in the installed PWA, and prompt() returns
// null there, which made "enter a reason" flows (warn/ban) impossible on
// phones. Renders a sonner custom toast with a text input; resolves the
// trimmed value on submit, null on cancel/dismiss.
function PromptCard({ message, placeholder, confirmLabel, onDone }: {
  message: string
  placeholder?: string
  confirmLabel: string
  onDone: (v: string | null) => void
}) {
  const [value, setValue] = useState('')
  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-3 w-80 space-y-2">
      <p className="text-sm font-medium text-gray-800">{message}</p>
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onDone(value.trim()) }}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
      />
      <div className="flex gap-2 justify-end">
        <button onClick={() => onDone(null)}
          className="px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          Cancel
        </button>
        <button onClick={() => onDone(value.trim())} disabled={!value.trim()}
          className="px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-50 transition-colors">
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}

export function promptToast(
  message: string,
  opts: { placeholder?: string; confirmLabel?: string } = {},
): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false
    const done = (v: string | null) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    const id = toast.custom(t => (
      <PromptCard
        message={message}
        placeholder={opts.placeholder}
        confirmLabel={opts.confirmLabel ?? 'Send'}
        onDone={v => { done(v); toast.dismiss(t) }}
      />
    ), {
      duration: Infinity,
      onDismiss:   () => done(null),
      onAutoClose: () => done(null),
    })
    void id
  })
}
