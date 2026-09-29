import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Application confirmed — Smileys Community',
  robots: { index: false, follow: false },
}

// Where the confirm link in the application email lands.
export default async function ApplyConfirmedPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams
  const ok = status === 'ok'
  return (
    <div className="min-h-screen bg-warm flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-card p-10 max-w-md w-full text-center">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-3">
          {ok ? 'Thanks — that’s confirmed' : status === 'later' ? 'Please try again in a little while' : 'This link has already been used or has expired'}
        </h1>
        <p className="text-gray-600 text-sm leading-relaxed mb-6">
          {ok
            ? 'Your application is with our team. We review every one by hand and will get back to you within 24–48 hours.'
            : 'If you applied, there is nothing more to do — our team will get back to you within 24–48 hours. Questions? Write to info@smileyscommunity.com.'}
        </p>
        <Link href="/" className="text-amber-600 font-semibold text-sm hover:underline">← Back to Smileys</Link>
      </div>
    </div>
  )
}
