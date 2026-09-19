'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'
import { forgetPushSync } from '@/lib/pushDevice'
import { useCurrentCity } from '@/hooks/useCurrentCity'

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

// "3h ago" is the quick read; the exact time is what tells you whether that
// Windows machine was you at lunch. On the city's clock, and hourCycle 'h23'
// rather than hour12:false, which renders midnight as 24:05 on some ICU
// builds — the browser's own zone was a different answer for anyone
// travelling, which is most of this community.
function exactTime(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23', ...(timeZone ? { timeZone } : {}),
    }).format(d)
  } catch { return '' }
}

// Which row is the browser you're reading this on. The server marks it when
// the session carries an id — sessions minted before per-device rows existed
// don't, so NOTHING is marked and every row looks equally disposable. The UA
// match is a guess and is labelled as one.
function looksLikeThisBrowser(ua: string | null): boolean {
  if (!ua || typeof navigator === 'undefined') return false
  return ua === navigator.userAgent
}

export default function ActiveDevicesSection() {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)
  const city = useCurrentCity()

  const load = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch('/app/api/auth/sessions', { credentials: 'include' })
      if (!res.ok) throw new Error('failed')
      const d = await res.json()
      setSessions(d.sessions ?? [])
    } catch {
      setError('Could not load your active devices')
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function revoke(s: DeviceSession) {
    // Signing a device out is not undoable from here — whoever is on it has
    // to log in again. Ask first, and name the device so it's clear which.
    const ok = await confirmToast(
      `Sign out ${prettyUA(s.userAgent)}? Whoever is using it will have to sign in again.`,
      { confirmLabel: 'Sign out' },
    )
    if (!ok) return
    setRevoking(s.id)
    try {
      const res = await fetch(`/app/api/auth/sessions/${s.id}`, {
        method:      'DELETE',
        credentials: 'include',
      })
      if (res.status === 404) {
        // A password change deletes every Session row and mints new ones, so
        // a list loaded before that points at ids the server no longer knows.
        // Nothing is wrong — the list is just stale.
        toast.success('That device is already signed out')
        await load()
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? 'Could not sign that device out — try again')
        return
      }
      toast.success('Device signed out')
      // Optimistic remove + refresh.
      setSessions(prev => prev?.filter(x => x.id !== s.id) ?? null)
      load()
    } catch {
      // A dropped connection used to throw straight out of here, leaving the
      // row stuck on "Signing out…" with nothing said.
      toast.error('Could not sign that device out — check your connection')
    } finally {
      setRevoking(null)
    }
  }

  async function revokeEverywhereElse() {
    const ok = await confirmToast(
      'Sign out every other device? This browser stays signed in; everything else has to sign in again, and stops getting notifications.',
      { confirmLabel: 'Sign them out' },
    )
    if (!ok) return
    setRevokingAll(true)
    try {
      const res = await fetch('/app/api/auth/sessions', { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? 'Could not sign the other devices out — try again')
        return
      }
      // The other devices' push registrations went with them — and this
      // browser's may have too, if its row predates per-device linking.
      // Forgetting the stamp re-registers it on the next page load.
      forgetPushSync()
      toast.success('Signed out everywhere else')
      await load()
    } catch {
      toast.error('Could not sign the other devices out — check your connection')
    } finally {
      setRevokingAll(false)
    }
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-red-500">{error}</p>
        <button onClick={load} className="text-sm font-semibold text-amber-600 hover:text-amber-700">Retry</button>
      </div>
    )
  }

  if (!sessions) {
    return <p className="text-xs text-gray-400">Loading…</p>
  }

  if (sessions.length === 0) {
    return <p className="text-xs text-gray-400">No active devices.</p>
  }

  // A session issued before per-device rows existed carries no id, so the
  // server can't mark any row as this one. Without a warning, the member
  // signs out the browser they're reading this on and wonders why.
  const knowsCurrent = sessions.some(s => s.current)

  return (
    <div>
      {!knowsCurrent && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2 leading-relaxed">
          We can&apos;t tell which of these is the browser you&apos;re using — this sign-in predates
          device tracking. One of them is this one, so signing them out may sign you out too.
        </p>
      )}
      <div className="divide-y divide-gray-50">
        {sessions.map(s => {
          const maybeThis = !knowsCurrent && looksLikeThisBrowser(s.userAgent)
          return (
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
                  {maybeThis && (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      Maybe this browser
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600 mt-0.5">
                  {s.ip ? `${s.ip} · ` : ''}Last active {timeAgo(s.lastUsedAt)}
                  {exactTime(s.lastUsedAt, city?.timezone) && ` · ${exactTime(s.lastUsedAt, city?.timezone)}`}
                </p>
              </div>
              {!s.current && (
                <button
                  onClick={() => revoke(s)}
                  disabled={revoking === s.id || revokingAll}
                  className="shrink-0 text-xs font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
                >
                  {revoking === s.id ? 'Signing out…' : 'Sign out'}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {/* One button for "someone else is in my account" — revoking rows one
          at a time can't reach a session with no id, and this can. */}
      <button
        onClick={revokeEverywhereElse}
        disabled={revokingAll || !!revoking}
        className="mt-3 w-full py-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold disabled:opacity-50"
      >
        {revokingAll ? 'Signing out…' : 'Sign out everywhere else'}
      </button>
    </div>
  )
}
