'use client'

import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

// Client island so the parent /guide page can be ISR-cached
// (revalidate = 300). The session check used to live in the server
// component, which forced force-dynamic and re-ran two Prisma
// groupBys on every request. Now the heavy data path is cached and
// only the CTA branches per-viewer.
export default function GuideCTA() {
  const { isLoggedIn, isLoading } = useAuth()

  // Reserve the vertical space during auth init so the page doesn't
  // jump when the CTA mounts. matches the visitor card's rendered
  // height closely enough that the jump is imperceptible.
  if (isLoading) {
    return <div className="mt-10 h-[260px]" aria-hidden="true" />
  }

  if (isLoggedIn) {
    return (
      <Link href="/contact?topic=guide"
        className="mt-10 block bg-gray-50 hover:bg-amber-50 border border-gray-100 hover:border-amber-200 rounded-2xl p-6 text-center transition-colors">
        <div className="text-2xl mb-2">💬</div>
        <p className="text-base font-bold text-gray-900 mb-1">Have a tip to share?</p>
        <p className="text-sm text-gray-600 max-w-xs mx-auto">
          Send your recommendations and we&apos;ll add the best ones here.
        </p>
      </Link>
    )
  }

  return (
    <div className="mt-10 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-8 text-center text-white shadow-lg">
      <div className="text-3xl mb-3">😊</div>
      <p className="text-xl font-extrabold mb-2">Living in Istanbul?</p>
      <p className="text-sm text-amber-50 max-w-md mx-auto mb-5 leading-relaxed">
        Smileys is a curated community of locals and expats hosting events across Istanbul every week. Apply to join — it&apos;s free.
      </p>
      <Link href="/apply"
        className="inline-block px-6 py-3 bg-white text-amber-600 font-bold rounded-xl hover:bg-amber-50 transition-colors text-sm">
        Apply to join →
      </Link>
      <p className="text-xs text-amber-100 mt-4">
        Already a member? <Link href="/login" className="font-semibold underline">Sign in</Link>
      </p>
    </div>
  )
}
