'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import BoardHub from '@/components/BoardHub'

// Board-feed deep links (?post= notification links) belong on /board. Same
// gating as the board wrapper: the hub's own URL-sync would otherwise race
// the redirect and strip the params.
function MarketInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [needsRedirect] = useState(() => !!searchParams.get('post'))

  useEffect(() => {
    if (needsRedirect) router.replace(`/board?${searchParams.toString()}`)
  }, [needsRedirect, router, searchParams])

  if (needsRedirect) return null
  return <BoardHub forcedView="market" />
}

export default function MarketplacePage() {
  return <Suspense><MarketInner /></Suspense>
}
