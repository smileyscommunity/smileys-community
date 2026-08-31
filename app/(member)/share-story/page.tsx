'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'

// Member story submission — the write side of /posts. Sits in the (member)
// group so the layout's auth gate handles guests; the API re-checks the
// session anyway. Deliberately plain: a title, a textarea, and honest copy
// about what happens next (review, possible edits, real byline). No drafts,
// no rich text — someone with a story to tell needs a page that gets out of
// the way, and the admin polishes formatting at review time.

const TITLE_MAX = 120
const BODY_MAX  = 10_000

export default function ShareStoryPage() {
  const [title,  setTitle]  = useState('')
  const [body,   setBody]   = useState('')
  const [saving, setSaving] = useState(false)
  const [done,   setDone]   = useState(false)

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
    } catch {
      toast.error('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
        <span className="text-5xl">📰</span>
        <h1 className="text-2xl font-extrabold text-gray-900 mt-4 mb-3">Story received — thank you!</h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          We read every submission. If it goes up, it's published under your name in{' '}
          <Link href="/posts" className="text-amber-600 font-semibold hover:underline">Stories</Link> —
          we may polish the formatting, and we'll only ever edit with a light hand.
        </p>
        <Link href="/dashboard" className="btn-primary px-6 py-3">Back to my dashboard</Link>
      </div>
    )
  }

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
      <p className="text-xs text-gray-400 mt-1.5 mb-6">
        {body.length.toLocaleString('en-US')} / {BODY_MAX.toLocaleString('en-US')} — blank lines become paragraphs.
      </p>

      <button
        onClick={submit}
        disabled={saving || !title.trim() || body.trim().length < 100}
        className="btn-primary px-8 py-3.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Submitting…' : 'Submit for review'}
      </button>
    </div>
  )
}
