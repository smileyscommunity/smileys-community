'use client'

import dynamic from 'next/dynamic'

const CommandPalette = dynamic(() => import('@/components/CommandPalette'), { ssr: false })
const InstallPrompt  = dynamic(() => import('@/components/InstallPrompt'),  { ssr: false })
const CookieBanner   = dynamic(() => import('@/components/CookieBanner'),   { ssr: false })
const WebVitalsReporter = dynamic(() => import('@/components/WebVitalsReporter'), { ssr: false })
const JoinStickyBar  = dynamic(() => import('@/components/JoinStickyBar'),  { ssr: false })
const JoinClickTracker = dynamic(() => import('@/components/JoinClickTracker'), { ssr: false })

export default function ClientOnlyComponents() {
  return (
    <>
      <CommandPalette />
      <CookieBanner />
      <JoinClickTracker />
      <JoinStickyBar />
      <WebVitalsReporter />
      <InstallPrompt />
    </>
  )
}
