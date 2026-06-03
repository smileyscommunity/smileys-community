'use client'

import { useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { isSafeHref } from '@/lib/safeUrl'

type View = 'pending' | 'approved' | 'rejected'

interface BusinessUser { id: string; name: string; email: string }
interface Business {
  id: string
  name: string
  category: string
  description: string
  neighborhood: string | null
  address: string | null
  phone: string | null
  website: string | null
  instagram: string | null
  logo: string | null
  coverImage: string | null
  isExpatOwned: boolean
  isExpatFriendly: boolean
  languages: string | null
  isApproved: boolean
  isActive: boolean
  createdAt: string
  submittedBy: BusinessUser
  reviewedBy: BusinessUser | null
}

function BusinessRow({ b, onAction }: { b: Business; onAction: () => void }) {
  const [expanded,      setExpanded]      = useState(false)
  const [loading,       setLoading]       = useState(false)
  // Inline confirm replaces a single-click destructive delete — matches
  // the pattern used everywhere else in /admin.
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function act(action: string) {
    setLoading(true)
    try {
      const r = await fetch('/app/api/admin/directory', {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'delete' ? { id: b.id } : { id: b.id, action }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        toast.error(d?.error || 'Failed')
        return
      }
      toast.success(action === 'approve' ? 'Approved!' : action === 'reject' ? 'Rejected' : action === 'delete' ? 'Deleted' : 'Updated')
      setConfirmDelete(false)
      onAction()
    } catch {
      toast.error('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-white/5 overflow-hidden">
      <button
        onClick={() => setExpanded(s => !s)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <svg className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white truncate">{b.name}</span>
            <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">{b.category}</span>
            {b.isExpatOwned    && <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full">Expat-owned</span>}
            {b.isExpatFriendly && <span className="text-[10px] text-teal-400 bg-teal-500/10 px-2 py-0.5 rounded-full">Expat-friendly</span>}
            {!b.isActive && <span className="text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Inactive</span>}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            by {b.submittedBy.name} · {b.neighborhood || 'no neighborhood'} · {new Date(b.createdAt).toLocaleDateString()}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
          <p className="text-xs text-zinc-300">{b.description}</p>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-500">
            {b.address   && <span>📍 {b.address}</span>}
            {b.phone     && <span>📞 {b.phone}</span>}
            {/* Defense-in-depth: only render the website link if its href
                passes the safe-URL allowlist. The API now validates on
                insert + update, but historical rows are untrusted. */}
            {b.website && isSafeHref(b.website) && (
              <a href={b.website} target="_blank" rel="noopener noreferrer nofollow" className="text-amber-400 hover:underline truncate">🌐 Website</a>
            )}
            {b.instagram && /^[A-Za-z0-9._]{1,30}$/.test(b.instagram.replace(/^@/, '')) && (
              <a href={`https://instagram.com/${b.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer nofollow" className="text-pink-400 hover:underline">📸 {b.instagram}</a>
            )}
            {b.languages && <span>🗣 {b.languages}</span>}
          </div>

          <div className="text-xs text-zinc-500">
            Submitted by <span className="text-zinc-300">{b.submittedBy.name}</span> ({b.submittedBy.email})
            {b.reviewedBy && <span> · Reviewed by {b.reviewedBy.name}</span>}
          </div>

          <div className="flex gap-2 flex-wrap pt-1">
            {/* "Pending" bucket: isApproved=false AND isActive=true. */}
            {!b.isApproved && b.isActive && (
              <>
                <button onClick={() => act('approve')} disabled={loading}
                  className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  Approve
                </button>
                <button onClick={() => act('reject')} disabled={loading}
                  className="text-xs font-semibold bg-red-600/80 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  Reject
                </button>
              </>
            )}
            {/* "Rejected" bucket — let admin restore back to pending. */}
            {!b.isApproved && !b.isActive && (
              <button onClick={() => act('approve')} disabled={loading}
                className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                Restore &amp; approve
              </button>
            )}
            {b.isApproved && (
              <button onClick={() => act('toggle-active')} disabled={loading}
                className="text-xs font-semibold bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {b.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button onClick={() => act('delete')} disabled={loading}
                  className="text-xs font-semibold bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  {loading ? '…' : 'Delete?'}
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  className="text-xs font-semibold text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors">
                  Cancel
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} disabled={loading}
                className="text-xs font-semibold bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminDirectoryPage() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const raw          = searchParams.get('status')
  const view: View   = raw === 'approved' || raw === 'rejected' ? raw : 'pending'

  const { data, loading, error, retry } = useAdminLoad<Business[]>(
    `/app/api/admin/directory?status=${view}`,
    (v): v is Business[] => Array.isArray(v),
  )
  const items = data ?? []

  function setView(v: View) {
    router.replace(`/admin/directory?status=${v}`)
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Business Directory</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Manage expat-owned and expat-friendly business listings</p>
        </div>
      </div>

      {/* Tabs. Pending / Approved / Rejected — the rejected bucket
          surfaces entries that previously fell into the void (reject
          set isApproved=false AND isActive=false, which matched
          neither of the two original tabs). */}
      <div className="flex gap-1 mb-5 bg-zinc-900 p-1 rounded-xl w-fit">
        {(['pending', 'approved', 'rejected'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`text-xs font-semibold px-4 py-1.5 rounded-lg capitalize transition-colors ${
              view === v ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}>
            {v}
          </button>
        ))}
      </div>

      {error ? (
        <LoadErrorBanner message={error} onRetry={retry} />
      ) : loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 rounded-xl h-14 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-14 text-zinc-500">
          <div className="text-3xl mb-2">🏢</div>
          <p className="text-sm">
            {view === 'pending'  ? 'No pending submissions' :
             view === 'approved' ? 'No approved listings yet' :
                                   'No rejected submissions'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(b => <BusinessRow key={b.id} b={b} onAction={retry} />)}
        </div>
      )}
    </div>
  )
}
