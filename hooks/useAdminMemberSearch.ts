'use client'

// Debounced server-side member search for admin pickers (event host and
// co-host, add-attendee, club add-member, partner assign). The old
// approach fetched /api/admin/users once and filtered client-side, but
// that endpoint caps at the 1000 most recently joined users — early
// members silently vanished from the pickers once the community crossed
// 1000. Searching server-side (the endpoint's ?search= matches
// name/email, case-insensitive) keeps every member findable.

import { useEffect, useState } from 'react'

// Fields the admin users endpoint returns that pickers care about.
// (profilePhoto isn't in the endpoint's select — declared optional so
// consumers with avatar types can default it to null.)
export interface AdminMemberHit {
  id: string
  name: string
  email: string
  color: string
  gender?: string | null
  nationality?: string | null
  phone?: string | null
  profilePhoto?: string | null
  noShowCount?: number
}

export function useAdminMemberSearch(query: string, minLength = 2) {
  const [results,   setResults]   = useState<AdminMemberHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < minLength) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/app/api/admin/users?search=${encodeURIComponent(q)}`, {
        credentials: 'include', signal: ctrl.signal,
      })
        .then(r => r.ok ? r.json() : [])
        .then(d => { setResults(Array.isArray(d) ? d : []); setSearching(false) })
        .catch((e: unknown) => {
          if ((e as Error)?.name !== 'AbortError') { setResults([]); setSearching(false) }
        })
    }, 300)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [query, minLength])

  return { results, searching }
}
