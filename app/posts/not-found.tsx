import Link from 'next/link'

// A story that isn't here — unpublished, withdrawn, or a slug that never
// existed. The root not-found spoke for the whole site; this one knows
// where the reader was going.
export default function StoryNotFound() {
  return (
    <main className="min-h-screen bg-warm">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <span aria-hidden="true" className="text-5xl">📰</span>
        <h1 className="text-2xl font-extrabold text-gray-900 mt-4 mb-3">That story isn&apos;t here</h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          It may have been taken down, or the link is wrong.
        </p>
        <Link href="/posts" className="btn-primary px-6 py-3">All stories</Link>
      </div>
    </main>
  )
}
