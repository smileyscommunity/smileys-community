import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-6">😕</div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-3">Page not found</h1>
        <p className="text-gray-500 mb-8 leading-relaxed">
          This page doesn't exist or may have moved.<br />
          Let's get you back to something good.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/events"
            className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors"
          >
            Browse events
          </Link>
          <Link
            href="/"
            className="px-6 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-sm transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  )
}
