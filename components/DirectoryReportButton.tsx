'use client'

// Tiny inline "Report a problem" trigger on each directory card. Opens
// a small modal where anyone (logged-in or anonymous) can flag a stale
// or wrong entry. Reports land in /admin/directory under the Reports
// tab for admin triage.

import { useState } from 'react'
import { toast } from 'sonner'

const REASONS: { id: string; label: string }[] = [
  { id: 'closed',        label: '🚪 Closed permanently' },
  { id: 'wrong_info',    label: '📍 Wrong info (address, hours, etc.)' },
  { id: 'inappropriate', label: '⚠️ Inappropriate / spam' },
  { id: 'other',         label: '✏️ Something else' },
]

export default function DirectoryReportButton({
  businessId, businessName,
}: { businessId: string; businessName: string }) {
  const [open,    setOpen]    = useState(false)
  const [reason,  setReason]  = useState('')
  const [message, setMessage] = useState('')
  const [busy,    setBusy]    = useState(false)
  const [done,    setDone]    = useState(false)

  async function submit() {
    if (!reason) { toast.error('Pick a reason'); return }
    setBusy(true)
    try {
      const r = await fetch(`/app/api/directory/${businessId}/report`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, message }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error || 'Failed to send'); return }
      setDone(true)
    } catch {
      toast.error('Network error — not sent')
    } finally {
      setBusy(false)
    }
  }

  function close() {
    setOpen(false)
    // Reset after a frame so the close animation doesn't show the
    // fields wiping out.
    setTimeout(() => { setReason(''); setMessage(''); setDone(false) }, 200)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] text-gray-400 hover:text-red-600 hover:underline transition-colors"
      >
        Report a problem
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={close}>
          <div
            className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-5 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="text-base font-bold text-gray-900">Report a problem</h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">×</button>
            </div>
            <p className="text-xs text-gray-500 mb-4">"{businessName}"</p>

            {done ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-2">🙏</div>
                <p className="text-sm font-semibold text-gray-900">Thanks for flagging</p>
                <p className="text-xs text-gray-500 mt-1">An admin will review your report shortly.</p>
                <button onClick={close}
                  className="mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  {REASONS.map(r => (
                    <label key={r.id}
                      className={`flex items-center gap-2 text-sm border rounded-xl px-3 py-2 cursor-pointer transition-colors ${
                        reason === r.id ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}>
                      <input
                        type="radio"
                        name="reason"
                        value={r.id}
                        checked={reason === r.id}
                        onChange={() => setReason(r.id)}
                        className="accent-amber-500"
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder="More details (optional)…"
                  className="w-full text-sm bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={close}
                    className="text-sm font-semibold text-gray-500 hover:text-gray-700 px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={busy}
                    className="text-sm font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl px-4 py-2 transition-colors disabled:opacity-50"
                  >
                    {busy ? 'Sending…' : 'Send report'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
