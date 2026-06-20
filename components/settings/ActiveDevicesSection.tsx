'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

interface DeviceSession {
  id:         string
  userAgent:  string | null
  ip:         string | null
  createdAt:  string
  lastUsedAt: string
  expiresAt:  string
  current:    boolean
}

// Very rough UA → friendly name. We're not trying to be a UA-parser library
// — just give the user enough signal to spot "wait, I don't own a Windows
// machine, revoke that". Anything we can't parse falls back to the raw UA
// truncated.
function prettyUA(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const u = ua.toLowerCase()
  const os =
    u.includes('iphone')       ? 'iPhone'  :
    u.includes('ipad')         ? 'iPad'    :
    u.includes('mac os x')     ? 'Mac'     :
    u.includes('android')      ? 'Android' :
    u.includes('windows')      ? 'Windows' :
    u.includes('linux')        ? 'Linux'   :
    null
  const browser =
    u.includes('edg/')         ? 'Edge'     :
    u.includes('chrome')       ? 'Chrome'   :
    u.includes('firefox')      ? 'Firefox'  :
    u.includes('safari')       ? 'Safari'   :
    null
  if (os && browser) return `${browser} on ${os}`
  if (os) return os
  if (browser) return browser
  return ua.slice(0, 40)
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s  = Math.floor(ms / 1000)
  if (s < 60)        return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60)        return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)        return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30)        return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function ActiveDevicesSection() {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/app/api/auth/sessions', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      setSessions(d.sessions ?? [])
    } catch {
      setError('Could not load your active devices')
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function revoke(id: string) {
    setRevoking(id)
    try {
      const res = await fetch(`/app/api/auth/sessions/${id}`, {
        method:      'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        toast.error('Could not revoke that device')
        return
      }
      toast.success('Device signed out')
      // Optimistic remove + refresh.
      setSessions(prev => prev?.filter(s => s.id !== id) ?? null)
      load()
    } finally {
      setRevoking(null)
    }
  }

  if (error) {
    return <p className="text-xs text-red-500">{error}</p>
  }

  if (!sessions) {
    return <p className="text-xs text-gray-400">Loading…</p>
  }

  if (sessions.length === 0) {
    return <p className="text-xs text-gray-400">No active devices.</p>
  }

  return (
    <div className="divide-y divide-gray-50">
      {sessions.map(s => (
        <div key={s.id} className="flex items-center justify-between py-3 gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-800 truncate">
                {prettyUA(s.userAgent)}
              </p>
              {s.current && (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                  This device
                </span>
              )}
            </div>
            <p className="text-xs text-gray-600 mt-0.5">
              {s.ip ? `${s.ip} · ` : ''}Last active {timeAgo(s.lastUsedAt)}
            </p>
          </div>
          {!s.current && (
            <button
              onClick={() => revoke(s.id)}
              disabled={revoking === s.id}
              className="shrink-0 text-xs font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
            >
              {revoking === s.id ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
