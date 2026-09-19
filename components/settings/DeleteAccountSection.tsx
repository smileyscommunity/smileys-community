'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import PasswordToggle from '@/components/PasswordToggle'

// Two-step delete: confirm dialog requires password (matches the route's
// server-side bcrypt check) AND a typed-in 'DELETE' confirmation so a
// reflex click doesn't nuke the account.

export default function DeleteAccountSection() {
  const router = useRouter()
  const [open,     setOpen]     = useState(false)
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [confirm,  setConfirm]  = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  // 2FA accounts confirm with a code as well — deleting everything is at
  // least as sensitive as changing the login email, which already asks.
  const [totp,      setTotp]      = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (confirm.trim().toUpperCase() !== 'DELETE') {
      setError('Type DELETE to confirm')
      return
    }
    if (!password) {
      setError('Enter your password')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/app/api/auth/delete-account', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ password, code: totp || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Same machine-readable marker the email change uses: reveal the
        // code input rather than showing it to every member.
        if (d.error === 'code_required') {
          setNeedsTotp(true)
          setError('Enter a 6-digit code from your authenticator app to confirm.')
          return
        }
        setError(d.error ?? 'Could not delete account')
        return
      }
      toast.success('Account deleted')
      router.push('/login')
    } catch {
      setError('Could not reach the server — try again')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-600 leading-relaxed">
          Delete your profile, your messages, your photos and your work details
          permanently. Upcoming events you host are cancelled and the people who
          joined them are told. Past events and payments stay in the records as
          &quot;Deleted Member&quot;.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="text-sm font-semibold text-red-500 hover:text-red-600"
        >
          Delete my account
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* What actually happens, in the order it matters. The old copy said
          photos and RSVPs were cleared and stopped there — it never mentioned
          the events other people had joined, the reviews left under your name,
          or the mail already sent. */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-1.5">
        <p className="text-xs font-semibold text-red-900">This cannot be undone.</p>
        <p className="text-xs text-red-800 leading-relaxed">
          Your profile, photos, messages, club memberships, RSVPs, hangouts,
          work details and recovery codes are cleared.
        </p>
        <p className="text-xs text-red-800 leading-relaxed">
          Upcoming events you host are cancelled, and everyone who joined them
          is notified.
        </p>
        <p className="text-xs text-red-800 leading-relaxed">
          Reviews you left in public stay, with your rating but no text.
          Past events you attended and any payments stay in the records as
          &quot;Deleted Member&quot;. Emails we&apos;ve already sent you can&apos;t be
          recalled, and payment records are kept for accounting.
        </p>
      </div>

      <div>
        <label htmlFor="delete-password" className="block text-xs font-medium text-gray-600 mb-1">Your password</label>
        <div className="relative">
          <input
            id="delete-password"
            name="delete-password"
            type={showPw ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            className="input pr-12"
          />
          <PasswordToggle visible={showPw} onToggle={() => setShowPw(p => !p)} />
        </div>
      </div>

      {needsTotp && (
        <div>
          <label htmlFor="delete-totp" className="block text-xs font-medium text-gray-600 mb-1">Code from your authenticator app</label>
          <input
            id="delete-totp"
            name="delete-totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={totp}
            onChange={e => setTotp(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="input text-center tracking-widest"
          />
        </div>
      )}

      <div>
        <label htmlFor="delete-confirm" className="block text-xs font-medium text-gray-600 mb-1">Type <span className="font-mono text-red-600">DELETE</span> to confirm</label>
        <input
          id="delete-confirm"
          name="delete-confirm"
          type="text"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          required
          className="input"
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setPassword(''); setConfirm(''); setError(null); setTotp(''); setNeedsTotp(false) }}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || (needsTotp && totp.length !== 6)}
          className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete forever'}
        </button>
      </div>
    </form>
  )
}
