'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import posthog from 'posthog-js'
import { useAuth } from '@/contexts/AuthContext'
import AvatarImg from '@/components/AvatarImg'
import { avatarUrl } from '@/lib/data'
import { confirmToast } from '@/lib/confirmToast'

interface Tip {
  id: string; body: string; createdAt: string
  user: { id: string; name: string; color: string; profilePhoto: string | null }
  likeCount: number; viewerLiked: boolean; mine: boolean
}

// §25 — "Tips from Smileys": short member advice under each experience.
// Client island (pages are ISR-cached); renders nothing while empty for
// guests so the page doesn't grow an empty box.
export default function TipsBlock({ slug }: { slug: string }) {
  const { user, isLoggedIn } = useAuth()
  const [tips,    setTips]    = useState<Tip[]>([])
  const [loaded,  setLoaded]  = useState(false)
  const [draft,   setDraft]   = useState('')
  const [posting, setPosting] = useState(false)
  const [staff,   setStaff]   = useState(false)

  useEffect(() => {
    fetch(`/app/api/guide/${slug}/tips`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { tips: [] })
      .then(d => { setTips(d.tips ?? []); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [slug])

  useEffect(() => {
    if (isLoggedIn) setStaff(user.role === 'admin' || user.role === 'moderator')
  }, [isLoggedIn, user])

  async function submit() {
    if (posting || draft.trim().length < 10) return
    setPosting(true)
    try {
      const res = await fetch(`/app/api/guide/${slug}/tips`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not post tip'); return }
      setTips(prev => [data.tip, ...prev])
      setDraft('')
      posthog.capture('guide_tip_posted', { slug })
      toast.success('Tip added — thanks!')
    } finally {
      setPosting(false)
    }
  }

  async function toggleLike(tip: Tip) {
    if (!isLoggedIn) { toast.error('Join Smileys to like tips'); return }
    const res = await fetch(`/app/api/guide/tips/${tip.id}/like`, { method: 'POST', credentials: 'include' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.error ?? 'Something went wrong'); return }
    setTips(prev => prev.map(t => t.id === tip.id ? { ...t, viewerLiked: data.liked, likeCount: data.likeCount } : t))
  }

  async function remove(tip: Tip) {
    if (!await confirmToast('Delete this tip?')) return
    const res = await fetch(`/app/api/guide/${slug}/tips?tip=${tip.id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) { toast.error('Could not delete'); return }
    setTips(prev => prev.filter(t => t.id !== tip.id))
  }

  // Nothing to show and nobody who could add — stay invisible.
  if (loaded && tips.length === 0 && !isLoggedIn) return null

  return (
    <section>
      <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-3">Tips from Smileys</h2>

      {tips.length > 0 && (
        <div className="space-y-3 mb-4">
          {tips.map(t => (
            <div key={t.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <AvatarImg src={avatarUrl(t.user.profilePhoto, 64)} name={t.user.name} color={t.user.color}
                  size="w-8 h-8" textSize="text-xs" className="shrink-0" />
                <div className="flex-1 min-w-0">
                  {/* §39 (Members brief) — community advice gets a human
                      identity; profiles are member-only, so guests see
                      the name without a link. */}
                  {isLoggedIn ? (
                    <Link href={`/members/${t.user.id}`}
                      onClick={() => posthog.capture('member_viewed', { from: 'guide_tip', memberId: t.user.id })}
                      className="text-xs font-bold text-gray-900 hover:text-amber-600 transition-colors">
                      {t.user.name.split(' ')[0]}
                    </Link>
                  ) : (
                    <p className="text-xs font-bold text-gray-900">{t.user.name.split(' ')[0]}</p>
                  )}
                  <p className="text-sm text-gray-700 mt-0.5 leading-relaxed">{t.body}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <button onClick={() => toggleLike(t)} aria-pressed={t.viewerLiked}
                    className={`text-xs font-bold px-2 py-1 rounded-lg transition-colors ${
                      t.viewerLiked ? 'text-red-500' : 'text-gray-400 hover:text-red-400'
                    }`}>
                    <span aria-hidden="true">❤️</span> {t.likeCount > 0 ? t.likeCount : ''}
                  </button>
                  {(t.mine || staff) && (
                    <button onClick={() => remove(t)} aria-label="Delete tip"
                      className="text-gray-300 hover:text-gray-500 text-sm px-1">×</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoggedIn ? (
        <div className="flex gap-2">
          <input type="text" value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            maxLength={220}
            placeholder="Share a tip — timing, seating, the thing you wish you'd known…"
            className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition" />
          <button onClick={submit} disabled={posting || draft.trim().length < 10}
            className="shrink-0 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors">
            {posting ? '…' : 'Add tip'}
          </button>
        </div>
      ) : tips.length > 0 && (
        <p className="text-xs text-gray-500">
          Have a tip of your own? <Link href="/apply" className="text-amber-600 font-semibold hover:underline">Join Smileys</Link> to share it.
        </p>
      )}
    </section>
  )
}
