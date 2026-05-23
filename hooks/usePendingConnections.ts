'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'

export function usePendingConnections() {
  const { isLoggedIn } = useAuth()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/connections', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const pending = Array.isArray(d.received)
          ? d.received.filter((c: { status: string }) => c.status === 'pending').length
          : 0
        setCount(pending)
      })
      .catch(() => {})
  }, [isLoggedIn])

  return count
}
