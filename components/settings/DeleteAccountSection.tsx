'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// Two-step delete: confirm dialog requires password (matches the route's
// server-side bcrypt check) AND a typed-in 'DELETE' confirmation so a
// reflex click doesn't nuke the account.

export default function DeleteAccountSection() {
  const router = useRouter()
  const [open,     setOpen]     = useState(false)
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)

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
        body:        JSON.stringify({ password }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error ?? 'Could not delete account')
        return
      }
      toast.success('Account deleted')
      router.push('/login')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500 leading-relaxed">
          Delete your account, your messages, your photos, and your tracking data
          permanently. Your past events and payments stay in the system as
          "Deleted Member" for accounting and event integrity.
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
      <div className="bg-red-50 border border-red-200 rounded-xl p-3">
        <p className="text-xs font-semibold text-red-900 mb-1">This cannot be undone.</p>
        <p className="text-xs text-red-800 leading-relaxed">
          Your profile, photos, messages, club memberships, RSVPs, hangouts,
          and recovery codes will be cleared. Past events you attended and
          any payments are retained for community records but shown as
          "Deleted Member".
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Your password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          className="input"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Type <span className="font-mono text-red-600">DELETE</span> to confirm</label>
        <input
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
          onClick={() => { setOpen(false); setPassword(''); setConfirm(''); setError(null) }}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete forever'}
        </button>
      </div>
    </form>
  )
}
