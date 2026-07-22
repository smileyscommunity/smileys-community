'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'

// TipTap is heavy — lazy-load it so anonymous handbook readers never pay
// for the editor bundle; it only downloads when a staff member edits.
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
  ssr: false,
  loading: () => <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-400">Loading editor…</div>,
})

// Inline staff editor for a handbook article — surfaces the same edit
// capability the admin panel has, right on the public article page. The
// body is rendered from server-sanitized HTML (sanitize-html is Node-only,
// so we never sanitize on the client); after a save we router.refresh() and
// the PUT's revalidateTag('handbook') feeds fresh, re-sanitized HTML back.
//
// Edit is gated two ways: the button only shows to admins/moderators (a
// client /api/auth/me check, kept out of the server render so the public
// page stays cacheable), and the PUT itself enforces canManagePosts.
interface Props {
  id:            string
  title:         string
  excerpt:       string | null
  sanitizedBody: string   // server-sanitized HTML for the read view
  rawBody:       string   // raw HTML for the editor
  category:      string
  catCls:        string
  coverImage:    string | null
  status:        string
  authorName:    string
  authorColor:   string | null
  publishedAt:   string | null   // ISO
  updatedAt:     string | null   // ISO
}

function formatDate(d: string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function EditableArticle(props: Props) {
  const router = useRouter()
  const [canEdit, setCanEdit] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)

  // Edit form state — only meaningful while editing; seeded from the
  // current props each time edit mode opens, so it always reflects the
  // latest saved content (props update after router.refresh()).
  const [title, setTitle]     = useState(props.title)
  const [excerpt, setExcerpt] = useState(props.excerpt ?? '')
  const [body, setBody]       = useState(props.rawBody)

  useEffect(() => {
    fetch('/app/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && (d.role === 'admin' || d.role === 'moderator')) setCanEdit(true) })
      .catch(() => {})
  }, [])

  function startEdit() {
    setTitle(props.title)
    setExcerpt(props.excerpt ?? '')
    setBody(props.rawBody)
    setEditing(true)
  }

  async function save() {
    if (!title.trim() || !body.trim()) { toast.error('Title and body are required'); return }
    setSaving(true)
    try {
      const res = await fetch(`/app/api/admin/posts/${props.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Preserve fields we don't edit inline (cover, status, category) so
        // the PUT doesn't reset them to defaults.
        body: JSON.stringify({
          title:      title.trim(),
          excerpt:    excerpt.trim(),
          body,
          coverImage: props.coverImage,
          status:     props.status,
          category:   props.category,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Save failed')
        return
      }
      toast.success('Article saved')
      setEditing(false)
      router.refresh()
    } catch {
      toast.error('Network error — could not save')
    } finally {
      setSaving(false)
    }
  }

  // ---- Edit view --------------------------------------------------------
  if (editing) {
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-gray-100">
          <span className="text-xs font-bold text-amber-600 uppercase tracking-widest">Editing article</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setEditing(false)} disabled={saving}
              className="px-3 py-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        {!props.coverImage && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
            <span aria-hidden="true">🖼</span>
            <span>No cover image — shared links use an auto-generated title card. Add a cover in the admin post editor for a stronger preview (real photos get more clicks).</span>
          </div>
        )}

        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Title</label>
        <input value={title} onChange={e => setTitle(e.target.value)}
          className="w-full px-3 py-2.5 mb-4 rounded-xl border border-gray-200 text-lg font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400" />

        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Quick summary</label>
        <textarea value={excerpt} onChange={e => setExcerpt(e.target.value)} rows={2}
          className="w-full px-3 py-2.5 mb-4 rounded-xl border border-gray-200 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />

        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Body</label>
        <RichTextEditor value={body} onChange={setBody} placeholder="Write the article — headings, lists and links are in the toolbar." />
      </div>
    )
  }

  // ---- Read view (identical markup to the original server render) --------
  return (
    <>
      {canEdit && (
        <div className="flex justify-end mb-3">
          <button onClick={startEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-bold hover:bg-amber-100 transition-colors">
            ✏️ Edit article
          </button>
        </div>
      )}

      {props.coverImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={props.coverImage} alt={props.title} className="w-full h-56 sm:h-72 object-cover rounded-2xl mb-8" />
      )}

      <span className={`inline-block px-2 py-1 rounded-full text-[11px] font-bold ${props.catCls}`}>{props.category}</span>
      <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 mt-4 mb-5 leading-[1.1] tracking-tight">
        {props.title}
      </h1>

      <div className="flex items-center gap-3 text-xs text-gray-600 mb-8 pb-8 border-b border-gray-100">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
          style={{ backgroundColor: props.authorColor ?? '#f59e0b' }}>
          {props.authorName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-700">by {props.authorName}</p>
          <p className="text-xs text-gray-400">
            {props.publishedAt && `Published ${formatDate(props.publishedAt)}`}
            {props.updatedAt && props.publishedAt && new Date(props.updatedAt).getTime() !== new Date(props.publishedAt).getTime() &&
              ` · Last reviewed ${formatDate(props.updatedAt)}`}
          </p>
        </div>
      </div>

      {props.excerpt && (
        <div className="bg-amber-50 border-l-4 border-amber-400 rounded-r-xl p-5 mb-10">
          <p className="text-[10px] font-extrabold text-amber-700 uppercase tracking-widest mb-2">Quick summary</p>
          <p className="text-sm sm:text-base text-amber-950 leading-relaxed whitespace-pre-line">{props.excerpt}</p>
        </div>
      )}

      <div
        className="prose prose-sm sm:prose-base max-w-none
                   prose-headings:font-extrabold prose-headings:tracking-tight prose-headings:text-gray-900
                   prose-h2:mt-10 prose-h2:mb-3 prose-h2:text-xl sm:prose-h2:text-2xl
                   prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-base sm:prose-h3:text-lg
                   prose-p:text-gray-700 prose-p:leading-relaxed
                   prose-a:text-amber-600 hover:prose-a:underline prose-a:no-underline
                   prose-strong:text-gray-900
                   prose-li:text-gray-700
                   prose-ul:my-4 prose-ol:my-4
                   prose-blockquote:border-l-amber-300 prose-blockquote:text-gray-600 prose-blockquote:not-italic"
        dangerouslySetInnerHTML={{ __html: props.sanitizedBody }}
      />
    </>
  )
}
