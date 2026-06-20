'use client'

import dynamic from 'next/dynamic'

const CommandPalette = dynamic(() => import('@/components/CommandPalette'), { ssr: false })
const InstallPrompt  = dynamic(() => import('@/components/InstallPrompt'),  { ssr: false })
const CookieBanner   = dynamic(() => import('@/components/CookieBanner'),   { ssr: false })

export default function ClientOnlyComponents() {
  return (
    <>
      <CommandPalette />
      <CookieBanner />
      <InstallPrompt />
    </>
  )
}
