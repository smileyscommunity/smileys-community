'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

interface SecurityOverview {
  totpEnabled:          boolean
  backupCodesRemaining: number
  activeSessions:       number
}

interface SessionRow {
  id:         string
  userAgent:  string | null
  ip:         string | null
  createdAt:  string
  lastUsedAt: string
  expiresAt:  string
  current:    boolean
}

type Step =
  | 'idle'
  | 'confirm'         // QR + verify code
  | 'show-codes'      // first-time backup codes display
  | 'disable'         // disable confirmation
  | 'regen-codes'     // regenerate backup codes confirmation

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s  = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Best-effort UA parse for the device list. Anything we don't recognize
// falls back to the raw string truncated. Pure string match — no
// dependencies, no regexp catastrophes.
function uaLabel(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const lower = ua.toLowerCase()
  let os = 'Unknown'
  if      (lower.includes('iphone'))             os = 'iPhone'
  else if (lower.includes('ipad'))               os = 'iPad'
  else if (lower.includes('android'))            os = 'Android'
  else if (lower.includes('mac os x'))           os = 'Mac'
  else if (lower.includes('windows'))            os = 'Windows'
  else if (lower.includes('linux'))              os = 'Linux'
  let browser = ''
  if      (lower.includes('chrome/'))            browser = 'Chrome'
  else if (lower.includes('safari/'))            browser = 'Safari'
  else if (lower.includes('firefox/'))           browser = 'Firefox'
  else if (lower.includes('edg/'))               browser = 'Edge'
  return browser ? `${os} · ${browser}` : os
}

export default function AdminSecurityPage() {
  const searchParams = useSearchParams()
  const require2fa   = searchParams.get('require2fa') === '1'

  const [overview,  setOverview]  = useState<SecurityOverview | null>(null)
  const [sessions,  setSessions]  = useState<SessionRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [step,      setStep]      = useState<Step>('idle')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [secret,    setSecret]    = useState('')
  const [code,      setCode]      = useState('')
  const [busy,      setBusy]      = useState(false)
  const [shownCodes,    setShownCodes]    = useState<string[]>([])
  const [revokingId,    setRevokingId]    = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    try {
      const r = await fetch('/app/api/admin/security', { credentials: 'include' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error ?? `Couldn't load security overview (HTTP ${r.status})`)
        return
      }
      const d = await r.json()
      setOverview({
        totpEnabled:          !!d.totpEnabled,
        backupCodesRemaining: Number.isFinite(d.backupCodesRemaining) ? d.backupCodesRemaining : 0,
        activeSessions:       Number.isFinite(d.activeSessions)       ? d.activeSessions       : 0,
      })
    } catch {
      toast.error('Network error — could not load security overview')
    }
  }, [])

  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch('/app/api/auth/sessions', { credentials: 'include' })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error ?? `Couldn't load sessions (HTTP ${r.status})`)
        return
      }
      const d = await r.json()
      setSessions(Array.isArray(d?.sessions) ? d.sessions : [])
    } catch {
      toast.error('Network error — could not load sessions')
    }
  }, [])

  useEffect(() => {
    Promise.all([loadOverview(), loadSessions()]).finally(() => setLoading(false))
  }, [loadOverview, loadSessions])

  async function startSetup() {
    setBusy(true)
    try {
      const res = await fetch('/app/api/auth/2fa/setup', { credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? 'Failed to start 2FA setup'); return }
      setQrDataUrl(data.qrDataUrl ?? '')
      setSecret(data.secret ?? '')
      setStep('confirm')
    } catch {
      toast.error('Network error — could not start setup')
    } finally {
      setBusy(false)
    }
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/app/api/auth/2fa/setup', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.replace(/\s/g, '') }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? 'Failed to verify code'); return }
      // CRITICAL: the API returns backupCodes ONCE in this response. If
      // we don't surface them, the admin gets locked out of their account
      // on a lost phone. We force a modal step before returning to idle.
      const codes: string[] = Array.isArray(data?.backupCodes) ? data.backupCodes : []
      setShownCodes(codes)
      setCode('')
      setStep(codes.length > 0 ? 'show-codes' : 'idle')
      await loadOverview()
      if (codes.length === 0) {
        toast.success('Two-factor authentication enabled')
        if (require2fa) window.location.replace('/admin')
      }
    } catch {
      toast.error('Network error — could not enable 2FA')
    } finally {
      setBusy(false)
    }
  }

  async function disable2FA(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/app/api/auth/2fa/setup', {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.replace(/\s/g, '') }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? 'Failed to disable 2FA'); return }
      toast.success('Two-factor authentication disabled')
      setStep('idle')
      setCode('')
      await loadOverview()
    } catch {
      toast.error('Network error — could not disable 2FA')
    } finally {
      setBusy(false)
    }
  }

  async function regenerateBackupCodes(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/app/api/auth/2fa/backup-codes', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.replace(/\s/g, '') }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data?.error ?? 'Failed to regenerate codes'); return }
      const codes: string[] = Array.isArray(data?.backupCodes) ? data.backupCodes : []
      setShownCodes(codes)
      setCode('')
      setStep(codes.length > 0 ? 'show-codes' : 'idle')
      await loadOverview()
      if (codes.length === 0) toast.success('Backup codes regenerated')
    } catch {
      toast.error('Network error — could not regenerate codes')
    } finally {
      setBusy(false)
    }
  }

  async function revokeSession(id: string) {
    setRevokingId(id)
    try {
      const res = await fetch(`/app/api/auth/sessions/${id}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? 'Failed to revoke session')
        return
      }
      setSessions(prev => prev.filter(s => s.id !== id))
      setConfirmRevoke(null)
      toast.success('Session revoked')
      await loadOverview()
    } catch {
      toast.error('Network error — could not revoke session')
    } finally {
      setRevokingId(null)
    }
  }

  function copyCodes() {
    const text = shownCodes.join('\n')
    navigator.clipboard?.writeText(text)
      .then(() => toast.success('Codes copied to clipboard'))
      .catch(() => toast.error('Could not copy — select and copy manually'))
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <div className="h-8 w-40 bg-zinc-800 rounded animate-pulse" />
        <div className="h-40 bg-zinc-900 border border-zinc-800 rounded-2xl animate-pulse" />
        <div className="h-40 bg-zinc-900 border border-zinc-800 rounded-2xl animate-pulse" />
      </div>
    )
  }

  const totpEnabled = overview?.totpEnabled ?? false

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Security</h1>
        <p className="text-sm text-zinc-500 mt-1">Protect your admin account</p>
      </div>

      {require2fa && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/30">
          <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-red-300">Two-factor authentication required</p>
            <p className="text-xs text-red-300/80 mt-0.5">
              Admin access requires 2FA. Set it up below to continue — you only need to do this once.
            </p>
          </div>
        </div>
      )}

      {/* 2FA card */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        <div className="px-6 py-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${totpEnabled ? 'bg-emerald-500/10' : 'bg-zinc-800'}`}>
              <svg className={`w-5 h-5 ${totpEnabled ? 'text-emerald-400' : 'text-zinc-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white">Two-factor authentication</p>
                {totpEnabled
                  ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Enabled</span>
                  : <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500">Disabled</span>
                }
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                {totpEnabled
                  ? 'Your account requires a 6-digit code from your authenticator app on every login.'
                  : 'Add a second layer of protection. Requires Google Authenticator, Authy, or similar.'}
              </p>
            </div>
          </div>
          {step === 'idle' && (
            totpEnabled
              ? <button onClick={() => { setStep('disable'); setCode('') }} className="shrink-0 text-sm font-medium text-red-400 hover:text-red-300">Disable</button>
              : <button onClick={startSetup} disabled={busy} className="shrink-0 px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">{busy ? 'Loading…' : 'Set up'}</button>
          )}
        </div>

        {/* Setup — scan QR */}
        {step === 'confirm' && (
          <div className="border-t border-zinc-800 px-6 py-5 space-y-5">
            <div>
              <p className="text-sm font-semibold text-zinc-200 mb-1">1. Scan this QR code</p>
              <p className="text-xs text-zinc-500 mb-3">Open your authenticator app (Google Authenticator, Authy, 1Password, etc.) and scan the code below.</p>
              {qrDataUrl && (
                <div className="flex justify-center">
                  {/* QR codes from `qrcode` work on any background, but we
                      wrap them in a white tile so dark-mode camera apps
                      that boost contrast don't misread the modules. */}
                  <img src={qrDataUrl} alt="QR code" className="w-48 h-48 rounded-xl border border-zinc-800 bg-white p-2" />
                </div>
              )}
              {secret && (
                <details className="mt-3">
                  <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">Can't scan? Enter manually</summary>
                  <code className="block mt-2 text-xs bg-zinc-950 border border-zinc-800 px-3 py-2 rounded-lg break-all text-zinc-300 select-all">{secret}</code>
                </details>
              )}
            </div>

            <form onSubmit={confirmSetup} className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-zinc-200 mb-1">2. Enter the 6-digit code to confirm</p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-center tracking-[0.5em] font-mono text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setStep('idle'); setCode('') }}
                  className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-sm font-medium text-zinc-300 hover:bg-zinc-800">
                  Cancel
                </button>
                <button type="submit" disabled={busy || code.length !== 6}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                  {busy ? 'Verifying…' : 'Activate 2FA'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Show backup codes — first-time-only display. Hard-blocks return
            to idle until the admin explicitly acknowledges they've saved
            the codes. This is the only time the plaintext is ever visible. */}
        {step === 'show-codes' && (
          <div className="border-t border-zinc-800 px-6 py-5 space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-amber-300">Save these backup codes now</p>
                <p className="text-xs text-amber-300/80 mt-0.5">
                  Each code can be used once to log in if you lose your authenticator. You won't be able to see them again — store them in a password manager or print them.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {shownCodes.map(c => (
                <code key={c} className="px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-200 text-center select-all">
                  {c}
                </code>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={copyCodes}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Copy to clipboard
              </button>
              <button
                onClick={() => {
                  setShownCodes([])
                  setStep('idle')
                  if (require2fa) window.location.replace('/admin')
                }}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
              >
                I've saved them
              </button>
            </div>
          </div>
        )}

        {/* Disable 2FA */}
        {step === 'disable' && (
          <form onSubmit={disable2FA} className="border-t border-zinc-800 px-6 py-5 space-y-3">
            <p className="text-sm text-zinc-400">Enter your current authenticator code to confirm you want to disable 2FA.</p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoFocus
              required
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-center tracking-[0.5em] font-mono text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setStep('idle'); setCode('') }}
                className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-sm font-medium text-zinc-300 hover:bg-zinc-800">
                Cancel
              </button>
              <button type="submit" disabled={busy || code.length !== 6}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {busy ? 'Disabling…' : 'Disable 2FA'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Backup codes — only meaningful when 2FA is enabled. */}
      {totpEnabled && (
        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          <div className="px-6 py-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-white">Backup codes</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {overview?.backupCodesRemaining ?? 0} of 10 unused.
                {(overview?.backupCodesRemaining ?? 0) <= 3 && (overview?.backupCodesRemaining ?? 0) > 0 && (
                  <span className="text-amber-400 ml-1">Running low — regenerate soon.</span>
                )}
                {(overview?.backupCodesRemaining ?? 0) === 0 && (
                  <span className="text-red-400 ml-1">No codes left — regenerate now or you'll be locked out on lost phone.</span>
                )}
              </p>
            </div>
            {step === 'idle' && (
              <button
                onClick={() => { setStep('regen-codes'); setCode('') }}
                className="shrink-0 text-sm font-medium text-amber-400 hover:text-amber-300"
              >
                Regenerate
              </button>
            )}
          </div>
          {step === 'regen-codes' && (
            <form onSubmit={regenerateBackupCodes} className="border-t border-zinc-800 px-6 py-5 space-y-3">
              <p className="text-sm text-zinc-400">
                Regenerating issues a fresh batch of 10 codes and invalidates any old codes that were still unused.
                Enter your current authenticator code to confirm.
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoFocus
                required
                className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-sm text-center tracking-[0.5em] font-mono text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setStep('idle'); setCode('') }}
                  className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-sm font-medium text-zinc-300 hover:bg-zinc-800">
                  Cancel
                </button>
                <button type="submit" disabled={busy || code.length !== 6}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                  {busy ? 'Regenerating…' : 'Regenerate codes'}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Active sessions */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        <div className="px-6 py-5 border-b border-zinc-800">
          <p className="text-sm font-semibold text-white">Active devices</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {overview?.activeSessions ?? sessions.length} active session{(overview?.activeSessions ?? sessions.length) === 1 ? '' : 's'}. Revoke anything you don't recognize.
          </p>
        </div>
        <div className="divide-y divide-zinc-800">
          {sessions.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-zinc-500">No sessions found.</div>
          ) : sessions.map(s => (
            <div key={s.id} className="px-6 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white truncate">{uaLabel(s.userAgent)}</p>
                  {s.current && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">This device</span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">
                  {s.ip ?? 'unknown IP'} · last used {timeAgo(s.lastUsedAt)}
                </p>
              </div>
              {s.current ? (
                <span className="shrink-0 text-xs text-zinc-600">Current</span>
              ) : confirmRevoke === s.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => revokeSession(s.id)}
                    disabled={revokingId === s.id}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                  >
                    {revokingId === s.id ? '…' : 'Revoke?'}
                  </button>
                  <button
                    onClick={() => setConfirmRevoke(null)}
                    className="px-2 py-1.5 rounded-lg text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmRevoke(s.id)}
                  className="shrink-0 text-xs font-medium text-red-400 hover:text-red-300"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
