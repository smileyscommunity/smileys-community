'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Command } from 'cmdk'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'

interface Cmd {
  id: string; label: string; hint?: string; icon: string; action: () => void; group: string
}

interface SearchResults {
  events:   { id: string; title: string; date: string; emoji: string; neighborhood: string }[]
  members:  { id: string; name: string; color: string; profilePhoto: string | null; neighborhood: string | null; restricted?: boolean }[]
  clubs:    { id: string; name: string; emoji: string; slug: string; memberCount: number }[]
  listings: { id: string; title: string; category: string; price: string | null; neighborhood: string | null }[]
}

const LISTING_CAT_EMOJI: Record<string, string> = {
  ROOMS: '🏠', JOBS: '💼', SERVICES: '🛠️', BUY_SELL: '🛍️', FREE: '🎁',
  LOST_FOUND: '🔍', RECO: '⭐', PETS: '🐾', EXPERIENCES: '🎟️',
}

export default function CommandPalette() {
  const [open, setOpen]           = useState(false)
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<SearchResults | null>(null)
  const [searching, setSearching] = useState(false)
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router  = useRouter()
  const { user, isLoggedIn, logout } = useAuth()

  const go = useCallback((href: string) => {
    setOpen(false)
    setQuery('')
    setResults(null)
    router.push(href)
  }, [router])

  // Cmd+K / Ctrl+K toggle + external open trigger
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') { setOpen(false); setQuery(''); setResults(null) }
    }
    function onOpen() { setOpen(true) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpen)
    }
  }, [])

  // Live search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query || query.length < 2) { setResults(null); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/app/api/search?q=${encodeURIComponent(query)}`, { credentials: 'include' })
        const data = await res.json()
        setResults(data)
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const isAdmin = user?.role === 'admin'
  const isMod   = user?.role === 'moderator'
  const isHost  = user?.isClubHost === true

  const staticCommands: Cmd[] = [
    // Two visible clusters: "Navigate" is discovery (browse the
    // community), "You" is personal (your own stuff, hub first).
    { id: 'events',        label: 'Events',        hint: 'Browse upcoming events',     icon: '📅', group: 'Navigate', action: () => go('/events')        },
    { id: 'clubs',         label: 'Clubs',          hint: 'Explore clubs',              icon: '🏛️', group: 'Navigate', action: () => go('/clubs')         },
    { id: 'members',       label: 'Members',        hint: 'Discover the community',     icon: '👥', group: 'Navigate', action: () => go('/members')       },
    { id: 'hangouts',      label: 'Hangouts',       hint: 'Live meetups happening now',  icon: '🤝', group: 'Navigate', action: () => go('/hangouts')      },
    { id: 'board',         label: 'Board',          hint: 'Rooms, jobs & more',         icon: '📋', group: 'Navigate', action: () => go('/board')      },
    { id: 'directory',     label: 'Directory',      hint: 'Local businesses & services', icon: '🏢', group: 'Navigate', action: () => go('/directory')     },
    { id: 'dashboard',     label: 'Dashboard',      hint: 'Your personal dashboard',    icon: '⬛', group: 'You', action: () => go('/dashboard')     },
    { id: 'my-events',     label: 'My Events',      hint: 'Your events & QR codes',     icon: '🎟️', group: 'You', action: () => go('/my-events')     },
    { id: 'messages',      label: 'Messages',       hint: 'Direct messages',            icon: '💬', group: 'You', action: () => go('/messages')      },
    { id: 'notifications', label: 'Notifications',  hint: 'Your notifications',         icon: '🔔', group: 'You', action: () => go('/notifications') },
    { id: 'profile',       label: 'Profile',        hint: 'Edit your profile',          icon: '👤', group: 'You', action: () => go('/profile')       },

    ...(isAdmin ? [
      { id: 'a-dash',         label: 'Admin Dashboard',  hint: 'Overview & stats',           icon: '⬛', group: 'Admin', action: () => go('/admin')                      },
      { id: 'a-applications', label: 'Applications',     hint: 'Review member applications', icon: '📄', group: 'Admin', action: () => go('/admin/applications')          },
      { id: 'a-users',        label: 'Users',            hint: 'Manage all members',         icon: '👥', group: 'Admin', action: () => go('/admin/users')                 },
      { id: 'a-moderation',   label: 'Moderation',       hint: 'Reports & warnings',         icon: '🚨', group: 'Admin', action: () => go('/admin/moderation')            },
      { id: 'a-payments',     label: 'Payments',         hint: 'Financial records',          icon: '💳', group: 'Admin', action: () => go('/admin/payments')              },
      { id: 'a-events',       label: 'Manage Events',    hint: 'All community events',       icon: '📅', group: 'Admin', action: () => go('/admin/events')                },
      { id: 'a-board',        label: 'Community Board',  hint: 'Manage listings',            icon: '📋', group: 'Admin', action: () => go('/admin/listings')              },
      { id: 'a-broadcast',    label: 'Notifications',    hint: 'Send broadcasts',            icon: '📢', group: 'Admin', action: () => go('/admin/notifications')         },
      { id: 'a-analytics',    label: 'Analytics',        hint: 'Growth & revenue trends',    icon: '📊', group: 'Admin', action: () => go('/admin/analytics')             },
    ] : []),

    ...((isMod && !isAdmin) ? [
      { id: 'm-applications', label: 'Applications', hint: 'Review applications', icon: '📄', group: 'Moderator', action: () => go('/admin/applications') },
      { id: 'm-reports',      label: 'Reports',      hint: 'Community reports',   icon: '🚨', group: 'Moderator', action: () => go('/admin/moderation')   },
    ] : []),

    ...((isHost && !isAdmin) ? [
      { id: 'h-events',       label: 'My Club Events', hint: 'Manage your events',         icon: '📅', group: 'Host', action: () => go('/host/events')  },
      { id: 'h-checkin',      label: 'Check-in',       hint: 'Scan QR or check in guests', icon: '✅', group: 'Host', action: () => go('/host/checkin') },
    ] : []),

    ...(isLoggedIn ? [
      { id: 'sign-out', label: 'Sign out', hint: '', icon: '↩', group: 'Account', action: async () => { setOpen(false); await logout() } },
    ] : [
      { id: 'sign-in',  label: 'Sign in',  hint: '', icon: '→', group: 'Account', action: () => go('/login') },
    ]),
  ]

  const hasResults = results && (results.events.length + results.members.length + results.clubs.length + results.listings.length) > 0
  const showStatic = !query || query.length < 2

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4 bg-black/50 backdrop-blur-sm"
      onClick={() => { setOpen(false); setQuery(''); setResults(null) }}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200"
        onClick={e => e.stopPropagation()}
      >
        <Command label="Search" loop shouldFilter={showStatic}>
          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100">
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search events, members, clubs, board…"
              className="flex-1 text-sm text-gray-900 placeholder-gray-400 outline-none bg-transparent"
            />
            {searching && (
              <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
            )}
            <kbd className="text-xs font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">ESC</kbd>
          </div>

          <Command.List className="max-h-[min(480px,65vh)] overflow-y-auto py-2">
            <Command.Empty className="py-10 text-center text-sm text-gray-400">
              {searching ? 'Searching…' : 'No results found.'}
            </Command.Empty>

            {/* Live search results */}
            {!showStatic && results && (
              <>
                {results.events.length > 0 && (
                  <Command.Group className="px-2">
                    <div className="px-2 pt-3 pb-1">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest">Events</span>
                    </div>
                    {results.events.map(e => (
                      <Command.Item
                        key={e.id}
                        value={`event-${e.id}`}
                        onSelect={() => go(`/events/${e.id}`)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-sm data-[selected=true]:bg-amber-50 data-[selected=true]:text-amber-700 transition-colors mb-0.5"
                      >
                        <span className="w-7 h-7 flex items-center justify-center bg-amber-50 rounded-lg text-base shrink-0">{e.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{e.title}</p>
                          <p className="text-xs text-gray-400">{new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {e.neighborhood}</p>
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {results.members.length > 0 && (
                  <Command.Group className="px-2">
                    <div className="px-2 pt-3 pb-1">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest">Members</span>
                    </div>
                    {results.members.map(m => {
                      const photo = resolveImageUrl(m.profilePhoto)
                      return (
                        <Command.Item
                          key={m.id}
                          value={`member-${m.id}`}
                          onSelect={() => go(`/members/${m.id}`)}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-sm data-[selected=true]:bg-amber-50 data-[selected=true]:text-amber-700 transition-colors mb-0.5"
                        >
                          {photo ? (
                            <img src={photo} alt={m.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                              style={{ backgroundColor: m.color }}>
                              {m.name[0]}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate flex items-center gap-1">
                              {m.name}
                              {m.restricted && <span title="Private profile" className="text-xs shrink-0">🔒</span>}
                            </p>
                            {m.neighborhood && <p className="text-xs text-gray-400">{m.neighborhood}</p>}
                          </div>
                        </Command.Item>
                      )
                    })}
                  </Command.Group>
                )}

                {results.clubs.length > 0 && (
                  <Command.Group className="px-2">
                    <div className="px-2 pt-3 pb-1">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest">Clubs</span>
                    </div>
                    {results.clubs.map(c => (
                      <Command.Item
                        key={c.id}
                        value={`club-${c.id}`}
                        onSelect={() => go(`/clubs/${c.slug}`)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-sm data-[selected=true]:bg-amber-50 data-[selected=true]:text-amber-700 transition-colors mb-0.5"
                      >
                        <span className="w-7 h-7 flex items-center justify-center bg-gray-100 rounded-lg text-base shrink-0">{c.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{c.name}</p>
                          <p className="text-xs text-gray-400">{c.memberCount} members</p>
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {results.listings.length > 0 && (
                  <Command.Group className="px-2">
                    <div className="px-2 pt-3 pb-1">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest">Board & Marketplace</span>
                    </div>
                    {results.listings.map(l => (
                      <Command.Item
                        key={l.id}
                        value={`listing-${l.id}`}
                        onSelect={() => go(`/board/${l.id}`)}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-sm data-[selected=true]:bg-amber-50 data-[selected=true]:text-amber-700 transition-colors mb-0.5"
                      >
                        <span className="w-7 h-7 flex items-center justify-center bg-purple-50 rounded-lg text-base shrink-0">{LISTING_CAT_EMOJI[l.category] ?? '📋'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{l.title}</p>
                          <p className="text-xs text-gray-400">{[l.price, l.neighborhood].filter(Boolean).join(' · ')}</p>
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {!hasResults && !searching && (
                  <div className="py-10 text-center text-sm text-gray-400">No results for "{query}"</div>
                )}
              </>
            )}

            {/* Static navigation commands */}
            {showStatic && (() => {
              const groups = [...new Set(staticCommands.map(c => c.group))]
              return groups.map(group => {
                const items = staticCommands.filter(c => c.group === group)
                return (
                  <Command.Group key={group} className="px-2">
                    <div className="px-2 pt-3 pb-1">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest">{group}</span>
                    </div>
                    {items.map(cmd => (
                      <Command.Item
                        key={cmd.id}
                        value={`${cmd.label} ${cmd.hint ?? ''} ${cmd.group}`}
                        onSelect={cmd.action}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-sm text-gray-700 data-[selected=true]:bg-amber-50 data-[selected=true]:text-amber-700 transition-colors mb-0.5"
                      >
                        <span className="w-6 h-6 flex items-center justify-center text-base shrink-0">{cmd.icon}</span>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{cmd.label}</span>
                          {cmd.hint && <span className="ml-2 text-xs text-gray-400">{cmd.hint}</span>}
                        </div>
                        <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )
              })
            })()}
          </Command.List>

          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-400">
            <span className="hidden md:inline"><kbd className="font-semibold">↑↓</kbd> navigate</span>
            <span className="hidden md:inline"><kbd className="font-semibold">↵</kbd> open</span>
            <span className="hidden md:inline"><kbd className="font-semibold">⌘K</kbd> toggle</span>
            <span className="ml-auto">{user?.name ?? 'Smileys'}</span>
          </div>
        </Command>
      </div>
    </div>
  )
}
