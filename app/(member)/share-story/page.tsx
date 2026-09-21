'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'
import { timeAgo } from '@/lib/timeAgo'

// Member story submission — the write side of /posts. Sits in the (member)
// group so the layout's auth gate handles guests; the API re-checks the
// session anyway. Deliberately plain: a title, a textarea, and honest copy
// about what happens next (review, possible edits, real byline). No drafts,
// no rich text — someone with a story to tell needs a page that gets out of
// the way, and the admin polishes formatting at review time.
//
// Below the form: the member's own stories and where each one stands. A
// submission used to vanish into the queue with no way to see it was still
// there, or to take it back.

const TITLE_MAX = 120
const BODY_MIN  = 100
const BODY_MAX  = 10_000

interface MyStory {
  id:          string
  title:       string
  slug:        string
  status:      'submitted' | 'declined' | 'draft' | 'published'
  createdAt:   string
  publishedAt: string | null
}

const STATUS_PILL: Record<MyStory['status'], { label: string; cls: string }> = {
  submitted: { label: 'In review',     cls: 'bg-amber-100 text-amber-700' },
  declined:  { label: 'Not this time', cls: 'bg-gray-100 text-gray-500' },
  draft:     { label: 'Draft',         cls: 'bg-gray-100 text-gray-500' },
  published: { label: 'Published',     cls: 'bg-green-100 text-green-700' },
}

export default function ShareStoryPage() {
  const [title,   setTitle]   = useState('')
  const [body,    setBody]    = useState('')
  const [saving,  setSaving]  = useState(false)
  const [done,    setDone]    = useState(false)
  const [stories, setStories] = useState<MyStory[]>([])

  // 401 (or any failure) renders nothing — the layout gates guests anyway,
  // and an empty list has no empty state to show.
  const loadMine = useCallback(async () => {
    try {
      const res = await fetch('/app/api/posts/mine', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      setStories(Array.isArray(data?.stories) ? data.stories : [])
    } catch { /* leave whatever we had */ }
  }, [])

  useEffect(() => { loadMine() }, [loadMine])

  async function submit() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/app/api/posts/submit', {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: title.trim(), body: body.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't submit your story")
        return
      }
      setDone(true)
      loadMine()
    } catch {
      toast.error('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function withdraw(story: MyStory) {
    if (!(await confirmToast('Withdraw this story? It is removed from the review queue.', { confirmLabel: 'Withdraw' }))) return
    try {
      const res = await fetch(`/app/api/posts/mine/${story.id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Couldn't withdraw that story")
        return
      }
      setStories(prev => prev.filter(s => s.id !== story.id))
      toast.success('Story withdrawn')
    } catch {
      toast.error('Something went wrong')
    }
  }

  // A published story is on the site under the member's name — withdrawing
  // it is an editorial call, so the button isn't offered.
  const mine = stories.length === 0 ? null : (
    <section className="mt-12 pt-8 border-t border-gray-100 text-left">
      <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Your stories</h2>
      <ul className="divide-y divide-gray-100">
        {stories.map(s => {
          const pill = STATUS_PILL[s.status] ?? STATUS_PILL.draft
          return (
            <li key={s.id} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                {s.status === 'published' ? (
                  <Link href={`/posts/${s.slug}`} className="font-semibold text-gray-900 hover:text-amber-600 truncate block">{s.title}</Link>
                ) : (
                  <p className="font-semibold text-gray-900 truncate">{s.title}</p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold mr-2 ${pill.cls}`}>{pill.label}</span>
                  {timeAgo(s.status === 'published' && s.publishedAt ? s.publishedAt : s.createdAt)}
                </p>
              </div>
              {s.status !== 'published' && (
                <button
                  onClick={() => withdraw(s)}
                  className="text-xs font-semibold text-gray-400 hover:text-red-600 shrink-0"
                >
                  Withdraw
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
        <span className="text-5xl">📰</span>
        <h1 className="text-2xl font-extrabold text-gray-900 mt-4 mb-3">Story received — thank you!</h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          We read every submission. If it goes up, it&apos;s published under your name in{' '}
          <Link href="/posts" className="text-amber-600 font-semibold hover:underline">Stories</Link> —
          we may polish the formatting, and we&apos;ll only ever edit with a light hand.
        </p>
        <Link href="/dashboard" className="btn-primary px-6 py-3">Back to my dashboard</Link>
        {mine}
      </div>
    )
  }

  const bodyLen = body.trim().length

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-2">Share your story</h1>
        <p className="text-gray-600 leading-relaxed">
          The best pages on Smileys are written by members — how you found your people, a club that
          changed your week, a night that turned strangers into friends. Tell it in your own words;
          we review every story and publish the ones that go up under your name.
        </p>
      </div>

      <label className="block text-sm font-bold text-gray-700 mb-1.5" htmlFor="story-title">Title</label>
      <input
        id="story-title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        maxLength={TITLE_MAX}
        placeholder="How a Tuesday dinner fixed my move to a new city"
        className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent mb-5"
      />

      <label className="block text-sm font-bold text-gray-700 mb-1.5" htmlFor="story-body">Your story</label>
      <textarea
        id="story-body"
        value={body}
        onChange={e => setBody(e.target.value)}
        rows={12}
        maxLength={BODY_MAX}
        placeholder="Start anywhere — the first event you walked into works."
        className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-y leading-relaxed"
      />
      {/* The submit button is disabled under the minimum — say why, and how
          far to go, rather than leave a dead button to puzzle over. */}
      <p className="text-xs text-gray-400 mt-1.5 mb-6">
        {bodyLen < BODY_MIN
          ? `At least ${BODY_MIN} characters — ${BODY_MIN - bodyLen} to go`
          : `${body.length.toLocaleString('en-US')} / ${BODY_MAX.toLocaleString('en-US')} — blank lines become paragraphs.`}
      </p>

      <button
        onClick={submit}
        disabled={saving || !title.trim() || bodyLen < BODY_MIN}
        className="btn-primary px-8 py-3.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Submitting…' : 'Submit for review'}
      </button>

      {mine}
    </div>
  )
}
