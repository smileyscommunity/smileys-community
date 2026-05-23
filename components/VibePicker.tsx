'use client'

import { useState, useEffect } from 'react'

interface Tag {
  id: string
  name: string
  emoji: string
}

interface Group {
  id: string
  name: string
  emoji: string
  tags: Tag[]
}

interface Props {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

const TAG_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  Chill:      { bg: 'bg-teal-100',    text: 'text-teal-700',    border: 'border-teal-400'    },
  Active:     { bg: 'bg-green-100',   text: 'text-green-700',   border: 'border-green-400'   },
  Party:      { bg: 'bg-pink-100',    text: 'text-pink-700',    border: 'border-pink-400'    },
  Intimate:   { bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-300'     },
  Social:     { bg: 'bg-blue-100',    text: 'text-blue-700',    border: 'border-blue-400'    },
  Networking: { bg: 'bg-indigo-100',  text: 'text-indigo-700',  border: 'border-indigo-400'  },
  Learning:   { bg: 'bg-sky-100',     text: 'text-sky-700',     border: 'border-sky-400'     },
  Creative:   { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', border: 'border-fuchsia-400' },
  Food:       { bg: 'bg-orange-100',  text: 'text-orange-700',  border: 'border-orange-400'  },
  Cultural:   { bg: 'bg-rose-100',    text: 'text-rose-700',    border: 'border-rose-400'    },
  Outdoor:    { bg: 'bg-lime-100',    text: 'text-lime-700',    border: 'border-lime-400'    },
  Wellness:   { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-400' },
  Adventure:  { bg: 'bg-stone-100',   text: 'text-stone-700',   border: 'border-stone-400'   },
}

const GROUP_DESC: Record<string, string> = {
  Energy:     'The energy level of the event',
  Purpose:    'Why people come',
  Experience: 'What the event is about',
}

// tag name → suggested tag names
const SUGGESTIONS: Record<string, string[]> = {
  Party:      ['Social'],
  Networking: ['Chill', 'Active'],
  Outdoor:    ['Chill', 'Active'],
  Active:     ['Outdoor', 'Adventure'],
  Food:       ['Social', 'Chill'],
  Learning:   ['Networking'],
  Wellness:   ['Chill', 'Outdoor'],
  Adventure:  ['Active', 'Outdoor'],
  Creative:   ['Social'],
}

export default function VibePicker({ selectedIds, onChange }: Props) {
  const [groups,      setGroups]      = useState<Group[]>([])
  const [lastAdded,   setLastAdded]   = useState<string | null>(null)
  const [dismissed,   setDismissed]   = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/app/api/tags').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setGroups(d)
    })
  }, [])

  // flat lookup: name → Tag
  const tagByName: Record<string, Tag> = {}
  for (const g of groups) for (const t of g.tags) tagByName[t.name] = t

  // flat lookup: id → name
  const nameById: Record<string, string> = {}
  for (const g of groups) for (const t of g.tags) nameById[t.id] = t.name

  function toggle(id: string) {
    const isRemoving = selectedIds.includes(id)
    onChange(isRemoving ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
    if (!isRemoving) setLastAdded(nameById[id] ?? null)
    else if (nameById[id] === lastAdded) setLastAdded(null)
  }

  function addSuggestion(name: string) {
    const tag = tagByName[name]
    if (!tag || selectedIds.includes(tag.id)) return
    onChange([...selectedIds, tag.id])
    setLastAdded(name)
  }

  function dismiss() {
    if (lastAdded) setDismissed(prev => new Set(prev).add(lastAdded!))
    setLastAdded(null)
  }

  // compute visible suggestions for the current lastAdded tag
  const suggestions: Tag[] = lastAdded && !dismissed.has(lastAdded)
    ? (SUGGESTIONS[lastAdded] ?? [])
        .map(name => tagByName[name])
        .filter((t): t is Tag => !!t && !selectedIds.includes(t.id))
    : []

  if (!groups.length) return <div className="text-xs text-gray-400">Loading vibes…</div>

  return (
    <div className="space-y-3">
      {groups.map(group => (
        <div key={group.id}>
          <div className="flex items-center gap-1 mb-1.5">
            <span className="text-xs">{group.emoji}</span>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{group.name}</span>
            <span className="hidden sm:inline text-xs text-gray-300">· {GROUP_DESC[group.name] ?? ''}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.tags.map(tag => {
              const style    = TAG_STYLES[tag.name] ?? { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-300' }
              const isActive = selectedIds.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggle(tag.id)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border transition-all ${
                    isActive
                      ? `${style.bg} ${style.text} ${style.border}`
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {tag.emoji} {tag.name}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {suggestions.length > 0 && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-xl animate-fade-in">
          <span className="text-sm">💡</span>
          <span className="text-xs font-medium text-amber-700">
            Since you picked <span className="font-bold">{lastAdded}</span>, you might also want:
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {suggestions.map(tag => {
              const style = TAG_STYLES[tag.name] ?? { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-300' }
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => addSuggestion(tag.name)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border transition-all hover:opacity-80 ${style.bg} ${style.text} ${style.border}`}
                >
                  {tag.emoji} {tag.name} +
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="ml-auto text-amber-400 hover:text-amber-600 text-xs shrink-0"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
