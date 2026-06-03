'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface Props {
  /** Caller controls visibility — 2FA is enrollment-gated to admin / moderator
   *  roles today, so the parent shouldn't render this for members. */
  show: boolean
}

type Mode =
  | 'loading'
  | 'disabled'    // 2FA not enabled
  | 'enrolling'   // QR shown, awaiting code
  | 'codes'       // backup codes shown after successful enroll/regen
  | 'enabled'     // 2FA active

export default function TwoFactorSection({ show }: Props) {
  const [mode, setMode] = useState<Mode>('loading')
  const [qr,          setQr]          = useState<string | null>(null)
  const [code,        setCode]        = useState('')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [remaining,   setRemaining]   = useState<number | null>(null)

  // Determine current state. There's no dedicated "is 2FA enabled" GET, so we
  // probe the backup-codes endpoint — it returns 400 when 2FA is off and a
  // count when it's on. Cheap, no extra route required.
  useEffect(() => {
    if (!show) return
    fetch('/app/api/auth/2fa/backup-codes', { credentials: 'include' })
      .then(async res => {
        if (res.ok) {
          const d = await res.json()
          setRemaining(d.remaining ?? null)
          setMode('enabled')
        } else {
          setMode('disabled')
        }
      })
      .catch(() => setMode('disabled'))
  }, [show])

  if (!show) return null

  async function startEnroll() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/app/api/auth/2fa/setup', { credentials: 'include' })
      const d   = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not start enrollment'); return }
      setQr(d.qrDataUrl)
      setMode('enrolling')
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnroll() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/app/api/auth/2fa/setup', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ code }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Invalid code'); return }
      setBackupCodes(d.backupCodes ?? [])
      setMode('codes')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  async function regenerate() {
    const totp = window.prompt('Enter a current 6-digit code from your authenticator app to regenerate your backup codes:')
    if (!totp) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/app/api/auth/2fa/backup-codes', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ code: totp }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Could not regenerate codes'); return }
      setBackupCodes(d.backupCodes ?? [])
      setMode('codes')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    const totp = window.prompt('Enter a current 6-digit code from your authenticator app to disable 2FA:')
    if (!totp) return
    setBusy(true)
    try {
      const res = await fetch('/app/api/auth/2fa/setup', {
        method:      'DELETE',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ code: totp }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Could not disable 2FA'); return }
      toast.success('2FA disabled')
      setMode('disabled')
      setRemaining(null)
    } finally {
      setBusy(false)
    }
  }

  function downloadCodes() {
    if (!backupCodes) return
    const text = [
      'Smileys Community — 2FA Recovery Codes',
      'Generated: ' + new Date().toISOString(),
      '',
      'Each code can be used ONCE if you lose access to your authenticator app.',
      'Keep these somewhere safe (password manager, encrypted notes, printed).',
      '',
      ...backupCodes.map(c => '  ' + c),
    ].join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `smileys-2fa-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function copyAll() {
    if (!backupCodes) return
    navigator.clipboard.writeText(backupCodes.join('\n')).then(
      () => toast.success('Codes copied to clipboard'),
      () => toast.error('Could not copy — select and copy manually'),
    )
  }

  if (mode === 'loading') return <p className="text-xs text-gray-400">Loading…</p>

  if (mode === 'disabled') {
    return (
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          Use an authenticator app (1Password, Google Authenticator, Authy, etc.)
          for a 6-digit code every time you sign in.
        </p>
        <button
          onClick={startEnroll}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Setting up…' : 'Enable 2FA'}
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  }

  if (mode === 'enrolling' && qr) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Scan this QR code with your authenticator app, then enter the 6-digit code it generates.
        </p>
        <div className="flex justify-center bg-white border border-gray-200 rounded-xl p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="2FA QR code" className="w-40 h-40" />
        </div>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="input text-center tracking-widest text-lg"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={confirmEnroll}
          disabled={busy || code.length !== 6}
          className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Verifying…' : 'Verify & enable'}
        </button>
      </div>
    )
  }

  if (mode === 'codes' && backupCodes) {
    return (
      <div className="space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-amber-900 mb-1">Save these recovery codes</p>
          <p className="text-xs text-amber-800 leading-relaxed">
            Each code can be used ONCE to sign in if you lose your phone.
            They won't be shown again. Store them in your password manager
            or print them.
          </p>
        </div>
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 font-mono text-sm leading-relaxed">
          {backupCodes.map(c => (
            <div key={c} className="text-gray-800">{c}</div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={copyAll}
            className="flex-1 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-semibold"
          >
            Copy all
          </button>
          <button
            onClick={downloadCodes}
            className="flex-1 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-semibold"
          >
            Download
          </button>
        </div>
        <button
          onClick={() => {
            setBackupCodes(null)
            setMode('enabled')
            // Refresh count after consuming the codes view.
            fetch('/app/api/auth/2fa/backup-codes', { credentials: 'include' })
              .then(r => r.ok ? r.json() : { remaining: null })
              .then(d => setRemaining(d.remaining ?? null))
              .catch(() => {})
          }}
          className="w-full py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold"
        >
          I've saved my codes
        </button>
      </div>
    )
  }

  // mode === 'enabled'
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
        <p className="text-sm font-semibold text-gray-800">2FA is active</p>
      </div>
      <p className="text-xs text-gray-500">
        {remaining !== null
          ? `${remaining} recovery code${remaining === 1 ? '' : 's'} remaining.`
          : 'Recovery codes available.'}
        {remaining !== null && remaining <= 3 && (
          <span className="text-amber-600 font-semibold"> Generate more before you run out.</span>
        )}
      </p>
      <div className="flex gap-2">
        <button
          onClick={regenerate}
          disabled={busy}
          className="flex-1 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-semibold disabled:opacity-50"
        >
          Regenerate recovery codes
        </button>
        <button
          onClick={disable}
          disabled={busy}
          className="flex-1 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold disabled:opacity-50"
        >
          Disable 2FA
        </button>
      </div>
    </div>
  )
}
