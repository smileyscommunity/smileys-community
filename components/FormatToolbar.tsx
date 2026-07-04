'use client'

import React from 'react'

// A tiny formatting toolbar for any <textarea>. Buttons wrap the current
// selection in the markdown the app already renders via <RichText/>:
//   B → *bold*   I → _italic_   🔗 → inserts a link
// It operates on the textarea's live selection (via getEl) and restores
// focus + a sensible selection afterwards so typing can continue.
type Props = {
  getEl: () => HTMLTextAreaElement | null
  value: string
  onChange: (v: string) => void
  dark?: boolean
}

export default function FormatToolbar({ getEl, value, onChange, dark }: Props) {
  function wrap(token: string, placeholder: string) {
    const el = getEl()
    if (!el) return
    const start = el.selectionStart ?? value.length
    const end   = el.selectionEnd ?? value.length
    const sel   = value.slice(start, end) || placeholder
    const next  = value.slice(0, start) + token + sel + token + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      const e2 = getEl()
      if (!e2) return
      e2.focus()
      const inner = start + token.length
      e2.selectionStart = inner
      e2.selectionEnd   = inner + sel.length
    })
  }

  function insertLink() {
    const el = getEl()
    if (!el) return
    const start = el.selectionStart ?? value.length
    const end   = el.selectionEnd ?? value.length
    const selected = value.slice(start, end)
    // If a URL is already selected keep it; otherwise drop in a placeholder
    // the user can overtype. Bare URLs auto-link when rendered.
    const url  = /^https?:\/\//.test(selected) ? selected : 'https://'
    const next = value.slice(0, start) + url + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      const e2 = getEl()
      if (!e2) return
      e2.focus()
      e2.selectionStart = start
      e2.selectionEnd   = start + url.length
    })
  }

  const btn = dark
    ? 'w-7 h-7 flex items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-800 transition-colors'
    : 'w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 transition-colors'

  // onMouseDown preventDefault keeps the textarea selection from collapsing
  // when the button takes focus.
  return (
    <div className="flex items-center gap-0.5 mb-1.5">
      <button type="button" title="Bold  *text*" aria-label="Bold"
        onMouseDown={e => e.preventDefault()} onClick={() => wrap('*', 'bold')}
        className={`${btn} font-bold text-sm`}>B</button>
      <button type="button" title="Italic  _text_" aria-label="Italic"
        onMouseDown={e => e.preventDefault()} onClick={() => wrap('_', 'italic')}
        className={`${btn} italic text-sm`}>I</button>
      <button type="button" title="Insert link" aria-label="Insert link"
        onMouseDown={e => e.preventDefault()} onClick={insertLink}
        className={`${btn} text-xs`}>🔗</button>
    </div>
  )
}
