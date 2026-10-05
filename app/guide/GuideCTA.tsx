'use client'

import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'

// Client island: branches on the viewer. (It was framed as what let the
// page be statically cached; the page is dynamic regardless — see
// app/guide/page.tsx — but the per-viewer branch belongs in a client island
// either way, and the heavy reads are cached by unstable_cache independently.)
// `applyHref` carries the city: /apply?city=izmir from İzmir's guide, not the
// default city's form.
export default function GuideCTA({ cityName, citySlug, applyHref }: { cityName: string; citySlug: string; applyHref: string }) {
  const { isLoggedIn, isLoading } = useAuth()

  // Reserve the vertical space during auth init so the page doesn't
  // jump when the CTA mounts. matches the visitor card's rendered
  // height closely enough that the jump is imperceptible.
  if (isLoading) {
    return <div className="mt-10 h-[260px]" aria-hidden="true" />
  }

  if (isLoggedIn) {
    return (
      // The city rides along so the tip reaches the team tagged with it.
      <Link href={`/contact?topic=guide&city=${encodeURIComponent(citySlug)}`}
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
      <p className="text-xl font-extrabold mb-2">Living in {cityName}?</p>
      <p className="text-sm text-amber-50 max-w-md mx-auto mb-5 leading-relaxed">
        Smileys is a curated community of locals and expats hosting events across {cityName} every week. Apply to join — it&apos;s free.
      </p>
      <Link href={applyHref}
        className="inline-block px-6 py-3 bg-white text-amber-600 font-bold rounded-xl hover:bg-amber-50 transition-colors text-sm">
        Apply to join →
      </Link>
      <p className="text-xs text-amber-100 mt-4">
        Already a member? <Link href="/login" className="font-semibold underline">Sign in</Link>
      </p>
    </div>
  )
}
