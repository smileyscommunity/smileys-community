'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import BoardHub from '@/components/BoardHub'

// /board is the conversation feed. Marketplace deep links that predate the
// split — listing-category tabs, ?id=/?l= share links, ?q= searches (all in
// alert emails and old shares) — redirect to /marketplace with params intact.
//
// The hub must NOT render while a redirect is due: it has its own URL-sync
// effect that would race the redirect and strip the query before it lands.
const MARKET_TABS = new Set(['ALL', 'MINE', 'SAVED', 'ROOMS', 'JOBS', 'SERVICES', 'BUY_SELL',
  'FREE', 'LOST_FOUND', 'RECO', 'EXPERIENCES', 'PETS', 'WANTED', 'MOVING'])

function BoardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [needsRedirect] = useState(() => {
    const tab = searchParams.get('tab')?.toUpperCase()
    return (tab && MARKET_TABS.has(tab)) || !!searchParams.get('id') || !!searchParams.get('q') || !!searchParams.get('l')
  })

  useEffect(() => {
    if (needsRedirect) router.replace(`/marketplace?${searchParams.toString()}`)
  }, [needsRedirect, router, searchParams])

  if (needsRedirect) return null
  return <BoardHub forcedView="community" />
}

export default function BoardPage() {
  return <Suspense><BoardInner /></Suspense>
}
