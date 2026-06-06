'use client'

import { useEffect, useState } from 'react'
import { avatarUrl, getInitials } from '@/lib/data'

interface PollOption {
  id: string; text: string; voteCount: number; votedByMe: boolean
}
interface Poll {
  id: string; question: string; totalVotes: number
  myVoteOptionId: string | null; options: PollOption[]
}
interface PostAuthor {
  id: string; name: string; color: string; photo: string | null
}
interface PollPost {
  id: string; content: string; createdAt: string
  author: PostAuthor; poll: Poll
}

interface Props {
  slug: string
  canCreate: boolean
  currentUserId?: string
}

export default function ClubPolls({ slug, canCreate, currentUserId }: Props) {
  const [posts, setPosts]     = useState<PollPost[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions]   = useState(['', ''])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    fetch(`/app/api/clubs/${slug}/posts?type=poll`)
      .then(r => r.json())
      .then(d => {
        const pollPosts = (Array.isArray(d) ? d : []).filter((p: any) => p.poll)
        setPosts(pollPosts)
      })
      .finally(() => setLoading(false))
  }, [slug])

  async function vote(postId: string, optionId: string) {
    const res = await fetch(`/app/api/clubs/${slug}/posts/${postId}/poll`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optionId }),
    })
    if (!res.ok) return
    const data = await res.json()
    setPosts(prev => prev.map(p =>
      p.id !== postId ? p : { ...p, poll: { ...p.poll, ...data } }
    ))
  }

  async function submit() {
    setError('')
    const opts = options.map(o => o.trim()).filter(Boolean)
    if (!question.trim()) return setError('Question is required')
    if (opts.length < 2) return setError('Add at least 2 options')
    setSubmitting(true)
    const res = await fetch(`/app/api/clubs/${slug}/posts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: question.trim(), poll: { question: question.trim(), options: opts } }),
    })
    if (!res.ok) { setError('Failed to create poll'); setSubmitting(false); return }
    const newPost = await res.json()
    if (newPost.poll) setPosts(prev => [newPost, ...prev])
    setQuestion(''); setOptions(['', '']); setCreating(false)
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-card p-5 animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            {[...Array(3)].map((_, j) => <div key={j} className="h-8 bg-gray-100 rounded-xl" />)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {canCreate && !creating && (
        <button
          onClick={() => setCreating(true)}
          className="w-full bg-white rounded-2xl shadow-card px-5 py-4 text-left text-sm text-gray-400 hover:text-gray-600 border-2 border-dashed border-gray-200 hover:border-amber-300 transition-colors"
        >
          📊 Create a poll…
        </button>
      )}

      {creating && (
        <div className="bg-white rounded-2xl shadow-card p-5 space-y-4">
          <p className="font-semibold text-gray-900">New poll</p>
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ask a question…"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={opt}
                  onChange={e => setOptions(prev => prev.map((o, j) => j === i ? e.target.value : o))}
                  placeholder={`Option ${i + 1}`}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                {options.length > 2 && (
                  <button onClick={() => setOptions(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-400 text-lg px-1">×</button>
                )}
              </div>
            ))}
            {options.length < 6 && (
              <button onClick={() => setOptions(prev => [...prev, ''])} className="text-xs text-amber-600 hover:underline">+ Add option</button>
            )}
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setCreating(false); setError('') }} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            <button
              onClick={submit}
              disabled={submitting}
              className="px-4 py-2 bg-amber-500 text-white text-sm font-semibold rounded-xl hover:bg-amber-600 disabled:opacity-50"
            >
              {submitting ? 'Posting…' : 'Post poll'}
            </button>
          </div>
        </div>
      )}

      {!posts.length && !creating ? (
        <div className="bg-white rounded-2xl shadow-card p-12 text-center">
          <span className="text-4xl block mb-3">📊</span>
          <p className="text-gray-500">No polls yet.{canCreate ? ' Create the first one!' : ''}</p>
        </div>
      ) : (
        posts.map(post => (
          <div key={post.id} className="bg-white rounded-2xl shadow-card p-5">
            <div className="flex items-center gap-2.5 mb-3">
              <Avatar user={post.author} />
              <div>
                <p className="text-sm font-semibold text-gray-900">{post.author.name}</p>
                <p className="text-xs text-gray-400">
                  {new Date(post.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            </div>
            <p className="text-sm font-semibold text-gray-900 mb-3">{post.poll.question}</p>
            <div className="space-y-2">
              {post.poll.options.map(opt => {
                const pct = post.poll.totalVotes > 0 ? Math.round(opt.voteCount / post.poll.totalVotes * 100) : 0
                const isMyVote = post.poll.myVoteOptionId === opt.id
                const canVote = !!currentUserId
                return (
                  <button
                    key={opt.id}
                    onClick={() => canVote && vote(post.id, opt.id)}
                    disabled={!canVote}
                    className={`relative w-full text-left px-3 py-2.5 rounded-xl border overflow-hidden transition-all ${
                      isMyVote ? 'border-amber-400' : 'border-gray-200 hover:border-amber-300'
                    } ${!canVote ? 'cursor-default' : ''}`}
                  >
                    <div
                      className={`absolute inset-y-0 left-0 transition-all duration-500 ${isMyVote ? 'bg-amber-100' : 'bg-gray-100'}`}
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex justify-between items-center text-sm">
                      <span className={isMyVote ? 'font-semibold text-amber-700' : 'text-gray-700'}>
                        {isMyVote && <span className="text-amber-500 mr-1">✓</span>}
                        {opt.text}
                      </span>
                      <span className="text-xs text-gray-400">{pct}%</span>
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-2">{post.poll.totalVotes} {post.poll.totalVotes === 1 ? 'vote' : 'votes'}</p>
          </div>
        ))
      )}
    </div>
  )
}

function Avatar({ user }: { user: PostAuthor }) {
  const photo = avatarUrl(user.photo, 64)
  if (photo) return <img src={photo} alt={user.name} loading="lazy" className="w-8 h-8 rounded-full object-cover shrink-0" />
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: user.color }}>
      {getInitials(user.name)}
    </div>
  )
}
