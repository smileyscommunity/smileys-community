'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import DigitalCard from '@/components/DigitalCard'

export default function MemberCardPage() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<{
    id: string; name: string; color: string; profilePhoto?: string | null
    membershipType?: string; joinedAt?: string; neighborhood?: string | null; interests?: string[]
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d?.id) setProfile(d) })
      .finally(() => setLoading(false))
  }, [])

  const data = profile ?? {
    id:             user.id,
    name:           user.name,
    color:          user.color,
    profilePhoto:   user.profilePhoto,
    membershipType: 'member',
  }



  return (
    <div className="min-h-screen bg-warm flex flex-col">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-sm mx-auto px-4 pt-10 pb-4">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Member Card</h1>
          <p className="text-sm text-gray-600 mt-1">Show this at events for instant check-in</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-start px-6 pt-6 pb-10 gap-6">
        {loading ? (
          <div className="w-full max-w-sm rounded-3xl overflow-hidden animate-pulse" style={{ backgroundColor: user.color + '33' }}>
            <div className="h-64 bg-black/10 rounded-3xl" />
          </div>
        ) : (
          <div>
            <DigitalCard user={data} />
          </div>
        )}

        <p className="text-xs text-gray-400 text-center max-w-xs leading-relaxed">
          The QR code lets event hosts verify your membership instantly. Keep this handy when attending events.
        </p>

      </div>
    </div>
  )
}
