'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import PostForm from '../../PostForm'

export default function EditPostPage() {
  const { id } = useParams<{ id: string }>()
  const [post, setPost] = useState<any>(null)

  useEffect(() => {
    fetch(`/app/api/admin/posts/${id}`)
      .then(r => r.json())
      .then(setPost)
  }, [id])

  if (!post) return (
    <div className="p-6 flex items-center justify-center min-h-64">
      <div className="text-zinc-500">Loading…</div>
    </div>
  )

  return <PostForm initial={post} />
}
