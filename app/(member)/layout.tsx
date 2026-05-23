'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import PushPermission from '@/components/PushPermission'

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { isLoggedIn, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login')
  }, [isLoading, isLoggedIn, router])

  if (isLoading || !isLoggedIn) return null

  return (
    <>
      {children}
      <PushPermission />
    </>
  )
}
