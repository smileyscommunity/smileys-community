'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { resolveImageUrl, getInitials } from '@/lib/data'

interface Member { id: string; name: string; color: string; photo: string | null; restricted?: boolean }

function getMentionQuery(value: string, cursor: number): string | null {
  const match = value.slice(0, cursor).match(/@(\w+)$/)
  return match ? match[1] : null
}

function insertMention(value: string, cursor: number, name: string) {
  const match = value.slice(0, cursor).match(/@(\w+)$/)
  if (!match) return { text: value, newCursor: cursor }
  const firstName = name.split(' ')[0]
  const start     = cursor - match[0].length
  const inserted  = `@${firstName} `
  return { text: value.slice(0, start) + inserted + value.slice(cursor), newCursor: start + inserted.length }
}

function MemberDropdown({
  suggestions, activeIdx, onSelect, above,
}: {
  suggestions: Member[]; activeIdx: number; onSelect: (m: Member) => void; above?: boolean
}) {
  if (!suggestions.length) return null
  return (
    <div className={`absolute left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg z-50 overflow-hidden ${above ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
      {suggestions.map((m, i) => {
        const photo = resolveImageUrl(m.photo)
        return (
          <button key={m.id} type="button"
            onMouseDown={e => { e.preventDefault(); onSelect(m) }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${i === activeIdx ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
          >
            {photo
              ? <img src={photo} alt={m.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
              : <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: m.color }}>{getInitials(m.name)}</div>
            }
            <span className="text-sm font-medium text-gray-800">{m.name}</span>
            {m.restricted && <span title="Private profile" className="text-xs">🔒</span>}
            <span className="text-xs text-amber-500 ml-auto">@{m.name.split(' ')[0]}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── MentionTextarea ───────────────────────────────────────────────────────────

interface TextareaProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  rows?: number
  maxLength?: number
  className?: string
  disabled?: boolean
  style?: React.CSSProperties
  doAutoResize?: boolean
  autoFocus?: boolean
}

export default function MentionTextarea({
  value, onChange, onKeyDown,
  placeholder, rows, maxLength, className, disabled, style, doAutoResize, autoFocus,
}: TextareaProps) {
  const [suggestions, setSuggestions] = useState<Member[]>([])
  const [activeIdx, setActiveIdx]     = useState(0)
  const taRef   = useRef<HTMLTextAreaElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const timer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset height when parent clears the value after submit
  useEffect(() => {
    if (doAutoResize && value === '' && taRef.current) {
      taRef.current.style.height = 'auto'
    }
  }, [value, doAutoResize])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setSuggestions([])
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const close = useCallback(() => { setSuggestions([]); setActiveIdx(0) }, [])

  function fetchSuggestions(query: string) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/app/api/members/search?q=${encodeURIComponent(query)}`, { credentials: 'include' })
        if (res.ok) { setSuggestions(await res.json()); setActiveIdx(0) }
      } catch {}
    }, 200)
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    onChange(val)
    if (doAutoResize) {
      e.target.style.height = 'auto'
      e.target.style.height = `${e.target.scrollHeight}px`
    }
    const query = getMentionQuery(val, e.target.selectionStart ?? val.length)
    if (query) fetchSuggestions(query); else close()
  }

  function select(member: Member) {
    const el = taRef.current
    if (!el) return
    const { text, newCursor } = insertMention(value, el.selectionStart ?? value.length, member.name)
    onChange(text)
    close()
    requestAnimationFrame(() => {
      if (!taRef.current) return
      taRef.current.selectionStart = newCursor
      taRef.current.selectionEnd   = newCursor
      taRef.current.focus()
      if (doAutoResize) {
        taRef.current.style.height = 'auto'
        taRef.current.style.height = `${taRef.current.scrollHeight}px`
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); select(suggestions[activeIdx]); return }
      if (e.key === 'Escape')    { close(); return }
    }
    onKeyDown?.(e)
  }

  return (
    <div ref={wrapRef} className="relative">
      <textarea ref={taRef} value={value} onChange={handleChange} onKeyDown={handleKeyDown}
        placeholder={placeholder} rows={rows} maxLength={maxLength}
        className={className} disabled={disabled} style={style} autoFocus={autoFocus}
      />
      {!disabled && <MemberDropdown suggestions={suggestions} activeIdx={activeIdx} onSelect={select} />}
    </div>
  )
}

// ── MentionInput (single-line) ────────────────────────────────────────────────

interface InputProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  maxLength?: number
  className?: string
  autoFocus?: boolean
}

export function MentionInput({
  value, onChange, onKeyDown,
  placeholder, maxLength, className, autoFocus,
}: InputProps) {
  const [suggestions, setSuggestions] = useState<Member[]>([])
  const [activeIdx, setActiveIdx]     = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef  = useRef<HTMLDivElement>(null)
  const timer    = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setSuggestions([])
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const close = useCallback(() => { setSuggestions([]); setActiveIdx(0) }, [])

  function fetchSuggestions(query: string) {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/app/api/members/search?q=${encodeURIComponent(query)}`, { credentials: 'include' })
        if (res.ok) { setSuggestions(await res.json()); setActiveIdx(0) }
      } catch {}
    }, 200)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    onChange(val)
    const query = getMentionQuery(val, e.target.selectionStart ?? val.length)
    if (query) fetchSuggestions(query); else close()
  }

  function select(member: Member) {
    const el = inputRef.current
    if (!el) return
    const { text, newCursor } = insertMention(value, el.selectionStart ?? value.length, member.name)
    onChange(text)
    close()
    requestAnimationFrame(() => {
      if (!inputRef.current) return
      inputRef.current.selectionStart = newCursor
      inputRef.current.selectionEnd   = newCursor
      inputRef.current.focus()
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); select(suggestions[activeIdx]); return }
      if (e.key === 'Escape')    { close(); return }
    }
    onKeyDown?.(e)
  }

  return (
    <div ref={wrapRef} className="relative flex-1">
      <input ref={inputRef} type="text" value={value} onChange={handleChange} onKeyDown={handleKeyDown}
        placeholder={placeholder} maxLength={maxLength} className={`w-full ${className ?? ''}`} autoFocus={autoFocus}
      />
      <MemberDropdown suggestions={suggestions} activeIdx={activeIdx} onSelect={select} above />
    </div>
  )
}
