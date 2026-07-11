'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { downscaleImage } from '@/lib/image-resize'

// Values MUST match VALID_REASONS in app/api/reports/route.ts.
const REASONS = [
  { value: 'inappropriate', label: 'Inappropriate behavior',                 desc: 'Made others uncomfortable at an event or online' },
  { value: 'harassment',    label: 'Harassment / uncomfortable interaction', desc: 'Persistent unwanted contact or pressure' },
  { value: 'fake',          label: 'Fake profile',                           desc: 'Identity appears to be false or misleading' },
  { value: 'spam',          label: 'Spam / promotion',                       desc: 'Using Smileys to sell or self-promote' },
  { value: 'offensive',     label: 'Offensive content',                      desc: 'Shared something harmful or disrespectful' },
  { value: 'other',         label: 'Other',                                  desc: 'Something else not listed here' },
]

const TOTAL_STEPS = 4

interface Props {
  reportedId: string
  reportedName: string
  eventId?: string
}

export default function ReportButton({ reportedId, reportedName, eventId }: Props) {
  const [open,       setOpen]       = useState(false)
  const [step,       setStep]       = useState(1)
  const [reason,     setReason]     = useState('')
  const [details,    setDetails]    = useState('')
  const [screenshot, setScreenshot] = useState('')
  const [uploading,  setUploading]  = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState('')
  const [mounted,    setMounted]    = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Portal mount gate — modal renders to document.body to escape any
  // ancestor with backdrop-filter / transform / etc. that would otherwise
  // become the containing block for `position: fixed` and trap the overlay.
  useEffect(() => { setMounted(true) }, [])

  function reset() {
    setOpen(false); setStep(1); setReason(''); setDetails('')
    setScreenshot(''); setDone(false); setError('')
  }

  async function handleScreenshot(file: File) {
    setUploading(true)
    const upload = await downscaleImage(file)
    const fd = new FormData()
    fd.append('file', upload)
    fd.append('folder', 'general')
    const res  = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd })
    const data = await res.json()
    setUploading(false)
    if (data.url) setScreenshot(data.url)
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/app/api/reports', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportedId, reason, details, screenshot, eventId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to submit'); return }
      setDone(true)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const selectedReason = REASONS.find(r => r.value === reason)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-red-400 transition-colors flex items-center gap-1.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
        </svg>
        Report
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 flex items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          style={{ zIndex: 9999 }}
          onClick={reset}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {done ? (
              /* ── Confirmation ── */
              <div className="p-8 text-center">
                <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-extrabold text-gray-900 mb-2">Thanks. We'll review this shortly.</h3>
                <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                  Every report is handled personally by our team. You'll hear from us if we need more context.
                </p>
                <button onClick={reset} className="w-full py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors">
                  Close
                </button>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-start justify-between px-5 pt-5 pb-3">
                  <div>
                    <h3 className="font-extrabold text-gray-900 text-base">Report {reportedName}</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Step {step} of {TOTAL_STEPS}</p>
                  </div>
                  <button onClick={reset} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors mt-0.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Step bar */}
                <div className="flex gap-1 px-5 mb-5">
                  {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                    <div key={i} className={`flex-1 h-1 rounded-full transition-colors ${i < step ? 'bg-gray-900' : 'bg-gray-200'}`} />
                  ))}
                </div>

                {/* ── Step 1: Reason ── */}
                {step === 1 && (
                  <div className="px-5 pb-5">
                    <p className="text-sm font-semibold text-gray-700 mb-3">What's the issue?</p>
                    <div className="space-y-2">
                      {REASONS.map(r => (
                        <button
                          key={r.value}
                          onClick={() => setReason(r.value)}
                          className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                            reason === r.value ? 'border-gray-900 bg-gray-50' : 'border-gray-100 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-800">{r.label}</span>
                            {reason === r.value && (
                              <div className="w-4 h-4 rounded-full bg-gray-900 flex items-center justify-center shrink-0">
                                <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{r.desc}</p>
                        </button>
                      ))}
                    </div>
                    {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
                    <button
                      onClick={() => { if (reason) { setError(''); setStep(2) } else setError('Please select a reason to continue') }}
                      className="w-full mt-4 py-3 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-xl transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                )}

                {/* ── Step 2: Details ── */}
                {step === 2 && (
                  <div className="px-5 pb-5">
                    <p className="text-sm font-semibold text-gray-700 mb-1">What happened?</p>
                    <p className="text-xs text-gray-400 mb-3">Optional — but helpful for our review.</p>
                    <textarea
                      value={details}
                      onChange={e => setDetails(e.target.value.slice(0, 300))}
                      placeholder="Briefly describe the situation..."
                      rows={5}
                      className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-gray-300"
                    />
                    <div className="flex justify-end mt-1 mb-4">
                      <span className="text-xs text-gray-400">{details.length}/300</span>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => setStep(1)} className="flex-1 py-2.5 text-sm font-medium border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                        Back
                      </button>
                      <button onClick={() => setStep(3)} className="flex-1 py-2.5 text-sm font-semibold bg-gray-900 hover:bg-gray-800 text-white rounded-xl transition-colors">
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Step 3: Evidence ── */}
                {step === 3 && (
                  <div className="px-5 pb-5">
                    <p className="text-sm font-semibold text-gray-700 mb-1">Add a screenshot</p>
                    <p className="text-xs text-gray-400 mb-4">Optional — screenshots help us act faster.</p>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden"
                      onChange={e => e.target.files?.[0] && handleScreenshot(e.target.files[0])} />
                    {screenshot ? (
                      <div className="relative rounded-xl overflow-hidden mb-4 border border-gray-200">
                        <img src={screenshot} alt="Screenshot" className="w-full object-cover max-h-40" />
                        <button onClick={() => setScreenshot('')}
                          className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="w-full border-2 border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center gap-2 hover:border-gray-400 transition-colors mb-4 disabled:opacity-50">
                        {uploading ? (
                          <span className="text-sm text-gray-400">Uploading…</span>
                        ) : (
                          <>
                            <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span className="text-sm text-gray-400">Tap to upload screenshot</span>
                          </>
                        )}
                      </button>
                    )}
                    <div className="flex gap-3">
                      <button onClick={() => setStep(2)} className="flex-1 py-2.5 text-sm font-medium border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                        Back
                      </button>
                      <button onClick={() => setStep(4)} className="flex-1 py-2.5 text-sm font-semibold bg-gray-900 hover:bg-gray-800 text-white rounded-xl transition-colors">
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Step 4: Review & Submit ── */}
                {step === 4 && (
                  <div className="px-5 pb-5">
                    <div className="bg-gray-50 rounded-xl p-4 space-y-2 mb-4">
                      <div>
                        <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Reason</p>
                        <p className="text-sm font-semibold text-gray-800">{selectedReason?.label}</p>
                      </div>
                      {details && (
                        <div>
                          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Details</p>
                          <p className="text-sm text-gray-600">{details}</p>
                        </div>
                      )}
                      {screenshot && (
                        <div>
                          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Screenshot</p>
                          <img src={screenshot} alt="" className="mt-1 w-20 h-14 object-cover rounded-lg" />
                        </div>
                      )}
                    </div>

                    <p className="text-xs text-gray-400 leading-relaxed mb-5">
                      Reports are confidential. Our team reviews every case carefully and will take appropriate action. The reported user will never know who filed this report.
                    </p>

                    {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

                    <div className="flex gap-3">
                      <button onClick={() => setStep(3)} className="flex-1 py-2.5 text-sm font-medium border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                        Back
                      </button>
                      <button onClick={submit} disabled={loading}
                        className="flex-1 py-2.5 text-sm font-semibold bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors disabled:opacity-50">
                        {loading ? 'Submitting…' : 'Submit Report'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
