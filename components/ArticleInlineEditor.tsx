'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import RichTextEditor from '@/components/RichTextEditor'

interface Props {
  postId: string
  initial: {
    title: string
    excerpt: string
    body: string
    category: string
    status: string
    coverImage: string | null
  }
  /** Server-rendered article view (category badge, title, excerpt, author, body). */
  children: React.ReactNode
}

/**
 * Wraps the article's editable region on the public post page. For
 * admins/moderators it overlays an "Edit article" button that swaps the
 * server-rendered view for an inline editor — no trip to /admin/posts.
 * Everyone else just sees `children`. The PUT route enforces
 * canManagePosts server-side, so the client role check is purely UI.
 */
export default function ArticleInlineEditor({ postId, initial, children }: Props) {
  const router = useRouter()
  const { user, isLoggedIn } = useAuth()
  const canEdit = isLoggedIn && (user.role === 'admin' || user.role === 'moderator')

  const [editing, setEditing] = useState(false)
  const [title,   setTitle]   = useState(initial.title)
  const [excerpt, setExcerpt] = useState(initial.excerpt)
  const [body,    setBody]    = useState(initial.body)
  const [saving,  setSaving]  = useState(false)

  if (!canEdit) return <>{children}</>

  async function save() {
    if (!title.trim() || !body.trim()) {
      toast.error('Title and body are required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/app/api/admin/posts/${postId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Send status/category/coverImage unchanged — the PUT route derives
        // publishedAt from status, so omitting it would silently unpublish.
        body: JSON.stringify({
          title,
          excerpt,
          body,
          category:   initial.category,
          status:     initial.status,
          coverImage: initial.coverImage ?? '',
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || 'Failed to save')
        return
      }
      toast.success('Article updated')
      setEditing(false)
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setTitle(initial.title)
    setExcerpt(initial.excerpt)
    setBody(initial.body)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="relative">
        <button
          onClick={() => setEditing(true)}
          className="absolute right-0 -top-1 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-bold shadow-sm hover:bg-gray-700 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Edit article
        </button>
        {children}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 sm:p-6 mb-8">
      <div className="flex items-center justify-between mb-5">
        <span className="text-xs font-bold uppercase tracking-wider text-amber-700">Editing article</span>
        <span className="text-[11px] text-gray-500">
          {initial.status === 'published' ? 'Published — changes go live on save' : 'Draft'}
        </span>
      </div>

      <label className="block text-xs font-semibold text-gray-500 mb-1.5">Title</label>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="w-full px-3 py-2 rounded-xl border border-gray-300 bg-white mb-4 text-lg font-bold text-gray-900 outline-none focus:ring-2 focus:ring-amber-500"
      />

      <label className="block text-xs font-semibold text-gray-500 mb-1.5">Excerpt</label>
      <textarea
        value={excerpt}
        onChange={e => setExcerpt(e.target.value)}
        rows={2}
        placeholder="Optional summary shown under the title"
        className="w-full px-3 py-2 rounded-xl border border-gray-300 bg-white mb-4 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-amber-500 resize-y"
      />

      <label className="block text-xs font-semibold text-gray-500 mb-1.5">Body</label>
      <RichTextEditor value={body} onChange={setBody} placeholder="Write your article…" />

      <div className="flex items-center gap-2 mt-5">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={cancel}
          disabled={saving}
          className="px-4 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-100 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
