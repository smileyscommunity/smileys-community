import Link from 'next/link'
import { areApplicationsOpen } from '@/lib/communitySettings'

// Reads the intake switch per request so pausing/reopening applications from
// /admin/settings takes effect immediately (no deploy).
export const dynamic = 'force-dynamic'



export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  if (!areApplicationsOpen()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-warm px-4">
        <div className="max-w-md text-center bg-white rounded-2xl shadow-card p-8">
          <div className="text-4xl mb-4">🌿</div>
          <h1 className="text-xl font-extrabold text-gray-900 mb-2">Applications are closed right now</h1>
          <p className="text-sm text-gray-600 mb-6">
            We&apos;ve paused new member applications while we focus on our current community. Follow us on Instagram to hear when we reopen.
          </p>
          <Link href="/" className="inline-block px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors">
            Back to home
          </Link>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
