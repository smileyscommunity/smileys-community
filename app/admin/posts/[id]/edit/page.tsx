'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import PostForm from '../../PostForm'

interface PostInitial {
  id?:         string
  title?:      string
  excerpt?:    string
  body?:       string
  coverImage?: string
  status?:     string
  category?:   string
}

export default function EditPostPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  // 'loading' (null) | the post payload | 'error'. Previously a failed
  // fetch deserialized the { error } body into post state, the
  // truthiness check passed, and the form rendered with garbage values.
  const [post, setPost] = useState<PostInitial | null | 'error'>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/app/api/admin/posts/${id}`)
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          if (!cancelled) {
            toast.error(d?.error ?? `Couldn't load article (HTTP ${r.status})`)
            setPost('error')
          }
          return
        }
        const d = await r.json()
        if (!cancelled) setPost(d)
      })
      .catch(() => {
        if (!cancelled) {
          toast.error('Network error — could not load article')
          setPost('error')
        }
      })
    return () => { cancelled = true }
  }, [id])

  if (post === 'error') return (
    <div className="p-6 flex flex-col items-center justify-center min-h-64 gap-3">
      <p className="text-zinc-500">Couldn&apos;t load that article.</p>
      <button onClick={() => router.push('/admin/posts')}
        className="px-4 py-2 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm font-semibold transition-colors">
        Back to articles
      </button>
    </div>
  )

  if (!post) return (
    <div className="p-6 flex items-center justify-center min-h-64">
      <div className="text-zinc-500">Loading…</div>
    </div>
  )

  return <PostForm initial={post} />
}
