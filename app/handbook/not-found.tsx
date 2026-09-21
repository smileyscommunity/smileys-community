import Link from 'next/link'

// An article that isn't here — unpublished, moved, or a slug that never
// existed. The root not-found spoke for the whole site ("Browse events");
// this one knows the reader was looking something up.
export default function HandbookNotFound() {
  return (
    <main className="bg-white min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
        <span aria-hidden="true" className="text-5xl">📖</span>
        {/* Also serves the category route's 404, so it does not assume the
            reader was after an article. */}
        <h1 className="text-2xl font-extrabold text-gray-900 mt-4 mb-3">That page isn&apos;t in the Handbook</h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          It may have been taken down, or the link is wrong. The index has everything that is.
        </p>
        <Link href="/handbook" className="btn-primary px-6 py-3">The Handbook</Link>
      </div>
    </main>
  )
}
