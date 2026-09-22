'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'
import { confirmToast } from '@/lib/confirmToast'

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
// Edit is gated two ways: the button only shows to staff who can act on
// this article's city (a client /api/auth/me check, kept out of the server
// render so the public page stays cacheable), and the PUT itself enforces
// canManagePosts + canActOnCityContent. The raw body is NOT shipped with
// the page — it is fetched from the admin API when edit mode opens, so a
// guest never downloads the unsanitized source of every article they read.
interface Props {
  id:            string
  title:         string
  excerpt:       string | null
  sanitizedBody: string   // server-sanitized HTML for the read view
  // The article's city; null = national/global. Drives the moderator gate.
  cityId:        string | null
  // The raw stored value, round-tripped verbatim through the save PUT so an
  // inline edit never silently rewrites a legacy category key.
  category:      string
  // The canonical display label for that category (may differ from `category`
  // while legacy rows are still stored under their old keys).
  categoryLabel: string
  catCls:        string
  // Resolved to a servable URL for rendering only. The PUT must round-trip
  // the RAW stored value (coverImageRaw) — the resolved URL would fail the
  // server's cover-path check and the save with it.
  coverImage:    string | null
  coverImageRaw: string | null
  status:        string
  // Already projected for the viewer on the server — render as-is.
  byline:        { name: string; color: string }
  // Already formatted server-side in the city's timezone ("Published 30
  // August 2026"). No Date math in this component: formatting here ran in
  // the browser's locale and timezone and hydrated differently from the
  // server render.
  publishedText: string | null
  // Read fresh on the server (not from the article cache, which is five
  // minutes behind). Zero renders nothing.
  views:         number
  // Unpublished row, staff viewer. The page renders the big banner; this
  // component only adds a small note beside the toolbar.
  preview:       boolean
  // Freshness is computed on the server (see lib/handbook-review) and passed
  // down as plain strings. Deriving it here from `new Date()` would risk a
  // hydration mismatch when a render straddles a review boundary — and the
  // rule is that this line is either honest or absent, never approximate.
  reviewText:    string | null   // null = never reviewed; show no date at all
  reviewStale:   boolean         // past its review interval — editorial signal
  readingMinutes: number
  highStakes:    boolean         // render the "verify before you act" warning
  // Whether the article actually cites sources. The warning must not point at
  // an "official sources" section that isn't on the page — no article has been
  // given sources yet, so this is the common case, not the edge case.
  hasSources:    boolean
}

export default function EditableArticle(props: Props) {
  const router = useRouter()
  const [canEdit, setCanEdit] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [reviewing, setReviewing] = useState(false)

  // Edit form state — only meaningful while editing; seeded from the admin
  // API row each time edit mode opens, so it always reflects the latest
  // saved content rather than whatever this page was rendered from.
  const [title, setTitle]     = useState(props.title)
  const [excerpt, setExcerpt] = useState(props.excerpt ?? '')
  const [body, setBody]       = useState('')

  useEffect(() => {
    fetch('/app/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d) return
        // A moderator acts on their own city's content only (the PUT's
        // canActOnCityContent is the real gate — this is the button that
        // used to appear on every article, save, and read "Forbidden").
        // A moderator with no home city can act on nothing: canActInCity
        // fails closed for them, so they get no button either.
        const ok = d.role === 'admin'
          || (d.role === 'moderator' && props.cityId !== null && d.cityId === props.cityId)
        if (ok) setCanEdit(true)
      })
      .catch(() => {})
  }, [props.cityId])

  async function startEdit() {
    setLoadingEdit(true)
    try {
      const res = await fetch(`/app/api/admin/posts/${props.id}`, { credentials: 'include' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'Could not load the article for editing')
        return
      }
      setTitle(typeof d.title === 'string' ? d.title : props.title)
      setExcerpt(typeof d.excerpt === 'string' ? d.excerpt : (props.excerpt ?? ''))
      setBody(typeof d.body === 'string' ? d.body : '')
      setEditing(true)
    } catch {
      toast.error('Network error — could not load the article for editing')
    } finally {
      setLoadingEdit(false)
    }
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
          coverImage: props.coverImageRaw,
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

  // "Reviewed today" is the only way lastReviewedAt moves — it is never a
  // form field, because a date typed into a box is not a review.
  async function markReviewed() {
    const ok = await confirmToast(
      'Mark this article as reviewed today? Only do this after checking it against the official sources.',
      { confirmLabel: 'Mark reviewed' },
    )
    if (!ok) return
    setReviewing(true)
    try {
      const res = await fetch(`/app/api/admin/posts/${props.id}/reviewed`, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'Could not mark as reviewed')
        return
      }
      toast.success('Marked as reviewed today')
      router.refresh()
    } catch {
      toast.error('Network error — could not mark as reviewed')
    } finally {
      setReviewing(false)
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
        <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
          {props.preview && (
            <span className="mr-auto text-xs font-semibold text-amber-700">Preview — not published</span>
          )}
          <button onClick={markReviewed} disabled={reviewing || loadingEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 disabled:opacity-50 transition-colors">
            {reviewing ? 'Marking…' : '✓ Reviewed today'}
          </button>
          <button onClick={startEdit} disabled={loadingEdit || reviewing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-bold hover:bg-amber-100 disabled:opacity-50 transition-colors">
            {loadingEdit ? 'Loading…' : '✏️ Edit article'}
          </button>
        </div>
      )}

      {/* Hero: article cover only. Category-level banner fallback was removed —
          articles without a cover open text-first. Decorative: the h1 right
          below names the article, so the image carries no alt text of its own. */}
      {props.coverImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={props.coverImage} alt="" className="w-full h-56 sm:h-72 object-cover rounded-2xl mb-8" />
      )}

      <span className={`inline-block px-2 py-1 rounded-full text-[11px] font-bold ${props.catCls}`}>{props.categoryLabel}</span>
      <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 mt-4 mb-5 leading-[1.1] tracking-tight">
        {props.title}
      </h1>

      {/* Byline + freshness share one block above the rule. The review status
          is the Handbook's trust signal, so it sits on its own line at full
          weight rather than being buried in the grey meta text — but it stays
          inside the header group, because "who wrote this and when was it last
          checked" is one question, not two. */}
      <div className="mb-8 pb-8 border-b border-gray-100">
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
            style={{ backgroundColor: props.byline.color }}>
            {props.byline.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">by {props.byline.name}</p>
            <p className="text-xs text-gray-400">
              {props.publishedText}
              {props.publishedText ? ' · ' : ''}{props.readingMinutes} min read
              {props.views > 0 && ` · 👁 ${props.views.toLocaleString('en-US')} view${props.views === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {/* An article nobody has reviewed says so plainly; it never borrows
            `updatedAt` to look fresher than it is. */}
        <div className="mt-4">
          {props.reviewText === null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-[11px] font-bold text-gray-500">
              <span aria-hidden="true">○</span> Not yet reviewed
            </span>
          ) : (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ${
              props.reviewStale ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
            }`}>
              <span aria-hidden="true">{props.reviewStale ? '⏳' : '✓'}</span> {props.reviewText}
            </span>
          )}
        </div>
      </div>

      {props.excerpt && (
        <div className={`bg-amber-50 border-l-4 border-amber-400 rounded-r-xl p-5 ${props.highStakes ? 'mb-6' : 'mb-10'}`}>
          <p className="text-[10px] font-extrabold text-amber-700 uppercase tracking-widest mb-2">Quick summary</p>
          <p className="text-sm sm:text-base text-amber-950 leading-relaxed whitespace-pre-line">{props.excerpt}</p>
        </div>
      )}

      {/* High-stakes topics (residence, banking, healthcare) — acting on a
          stale step here costs a rejected application or a wasted trip, so the
          reader is pointed at the official source BEFORE the instructions,
          not after them. Deliberately calm and factual: this is a Handbook,
          not a hazard sign. */}
      {props.highStakes && (
        <div className="flex gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 mb-10">
          <span aria-hidden="true" className="text-base leading-none mt-0.5">⚠️</span>
          <p className="text-xs text-gray-700 leading-relaxed">
            <span className="font-bold text-gray-900">Rules and requirements change.</span>{' '}
            This article explains how the process works in practice — always confirm the
            current requirements with the official source
            {props.hasSources ? ' listed at the end of this article' : ''} before you act on it.
          </p>
        </div>
      )}

      {/* `[&_span[style]_*]:text-[color:inherit]`: a child's own class beats a
          colour inherited from a styled span, so bold inside a coloured
          passage would lose the colour without it. (This note used to live
          inside the className string and shipped in every article's HTML.) */}
      <div
        className="prose prose-sm sm:prose-base max-w-none
                   prose-headings:font-extrabold prose-headings:tracking-tight prose-headings:text-gray-900
                   prose-h2:mt-10 prose-h2:mb-3 prose-h2:text-xl sm:prose-h2:text-2xl
                   prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-base sm:prose-h3:text-lg
                   prose-p:text-gray-700 prose-p:leading-relaxed
                   prose-a:text-amber-600 hover:prose-a:underline prose-a:no-underline
                   prose-strong:text-gray-900
                   [&_span[style]_*]:text-[color:inherit]
                   prose-li:text-gray-700
                   prose-ul:my-4 prose-ol:my-4
                   prose-blockquote:border-l-amber-300 prose-blockquote:text-gray-600 prose-blockquote:not-italic"
        dangerouslySetInnerHTML={{ __html: props.sanitizedBody }}
      />
    </>
  )
}
