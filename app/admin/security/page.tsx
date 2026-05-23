'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

export default function AdminSecurityPage() {
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [step,        setStep]        = useState<'idle' | 'setup' | 'confirm' | 'disable'>('idle')
  const [qrDataUrl,   setQrDataUrl]   = useState('')
  const [secret,      setSecret]      = useState('')
  const [code,        setCode]        = useState('')
  const [busy,        setBusy]        = useState(false)

  useEffect(() => {
    fetch('/app/api/admin/security', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setTotpEnabled(d.totpEnabled); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function startSetup() {
    setBusy(true)
    const res = await fetch('/app/api/auth/2fa/setup', { credentials: 'include' })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error); setBusy(false); return }
    setQrDataUrl(data.qrDataUrl)
    setSecret(data.secret)
    setStep('confirm')
    setBusy(false)
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await fetch('/app/api/auth/2fa/setup', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.replace(/\s/g, '') }),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error); setBusy(false); return }
    toast.success('Two-factor authentication enabled')
    setTotpEnabled(true)
    setStep('idle')
    setCode('')
    setBusy(false)
  }

  async function disable2FA(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await fetch('/app/api/auth/2fa/setup', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.replace(/\s/g, '') }),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error); setBusy(false); return }
    toast.success('Two-factor authentication disabled')
    setTotpEnabled(false)
    setStep('idle')
    setCode('')
    setBusy(false)
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900">Security</h1>
        <p className="text-sm text-gray-500 mt-1">Protect your admin account</p>
      </div>

      {/* 2FA card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${totpEnabled ? 'bg-green-50' : 'bg-gray-100'}`}>
              <svg className={`w-5 h-5 ${totpEnabled ? 'text-green-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-900">Two-factor authentication</p>
                {totpEnabled
                  ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Enabled</span>
                  : <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Disabled</span>
                }
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {totpEnabled
                  ? 'Your account requires a 6-digit code from your authenticator app on every login.'
                  : 'Add a second layer of protection. Requires Google Authenticator, Authy, or similar.'}
              </p>
            </div>
          </div>
          {step === 'idle' && (
            totpEnabled
              ? <button onClick={() => { setStep('disable'); setCode('') }} className="shrink-0 text-sm font-medium text-red-600 hover:text-red-700">Disable</button>
              : <button onClick={startSetup} disabled={busy} className="shrink-0 px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">Set up</button>
          )}
        </div>

        {/* Setup — scan QR */}
        {step === 'confirm' && (
          <div className="border-t border-gray-100 px-6 py-5 space-y-5">
            <div>
              <p className="text-sm font-semibold text-gray-800 mb-1">1. Scan this QR code</p>
              <p className="text-xs text-gray-500 mb-3">Open your authenticator app (Google Authenticator, Authy, 1Password, etc.) and scan the code below.</p>
              {qrDataUrl && (
                <div className="flex justify-center">
                  <img src={qrDataUrl} alt="QR code" className="w-48 h-48 rounded-xl border border-gray-100" />
                </div>
              )}
              <details className="mt-3">
                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Can't scan? Enter manually</summary>
                <code className="block mt-2 text-xs bg-gray-50 px-3 py-2 rounded-lg break-all text-gray-600 select-all">{secret}</code>
              </details>
            </div>

            <form onSubmit={confirmSetup} className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-gray-800 mb-1">2. Enter the 6-digit code to confirm</p>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  required
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setStep('idle'); setCode('') }}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
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

        {/* Disable 2FA */}
        {step === 'disable' && (
          <form onSubmit={disable2FA} className="border-t border-gray-100 px-6 py-5 space-y-3">
            <p className="text-sm text-gray-600">Enter your current authenticator code to confirm you want to disable 2FA.</p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoFocus
              required
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-red-400"
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => { setStep('idle'); setCode('') }}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={busy || code.length !== 6}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {busy ? 'Disabling…' : 'Disable 2FA'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
