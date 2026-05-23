'use client'

import { useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'

interface Props {
  club: { id: string; name: string; slug: string; isPrivate: boolean }
  initialStatus: 'approved' | 'pending' | null
  isLoggedIn: boolean
}

export default function ClubJoinWidget({ club, initialStatus, isLoggedIn }: Props) {
  const [status,   setStatus]   = useState(initialStatus)
  const [loading,  setLoading]  = useState(false)

  async function join() {
    setLoading(true)
    const res = await fetch(`/app/api/clubs/${club.slug}/membership`, {
      method: 'POST', credentials: 'include',
    })
    if (res.ok) {
      const data = await res.json()
      setStatus(data.status)
      posthog.capture('club_joined', {
        club_id:    club.id,
        club_name:  club.name,
        club_slug:  club.slug,
        is_private: club.isPrivate,
        status:     data.status,
      })
    }
    setLoading(false)
  }

  async function leave() {
    setLoading(true)
    const res = await fetch(`/app/api/clubs/${club.slug}/membership`, {
      method: 'DELETE', credentials: 'include',
    })
    if (res.ok) {
      posthog.capture('club_left', {
        club_id:        club.id,
        club_name:      club.name,
        club_slug:      club.slug,
        previous_status: status,
      })
      setStatus(null)
    }
    setLoading(false)
  }

  if (!isLoggedIn) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-6">
        <h3 className="font-bold text-gray-900 mb-4">Join this club</h3>
        <p className="text-sm text-gray-500 mb-5">
          Become a member to get early access to events, exclusive content, and connect with the community.
        </p>
        <Link href="/dashboard" className="btn-primary w-full justify-center">
          Join {club.name}
        </Link>
        <p className="text-center text-xs text-gray-400 mt-3">Free to join</p>
      </div>
    )
  }

  if (status === 'approved') {
    return (
      <div className="bg-white rounded-2xl shadow-card p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <h3 className="font-bold text-gray-900">You&apos;re a member</h3>
        </div>
        <p className="text-sm text-gray-500 mb-5">
          You have full access to this club&apos;s events and community.
        </p>
        <button
          onClick={leave}
          disabled={loading}
          className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-40"
        >
          {loading ? 'Leaving…' : 'Leave club'}
        </button>
      </div>
    )
  }

  if (status === 'pending') {
    return (
      <div className="bg-white rounded-2xl shadow-card p-6">
        <h3 className="font-bold text-gray-900 mb-3">Request pending</h3>
        <p className="text-sm text-amber-600 font-medium bg-amber-50 rounded-xl px-3 py-2 mb-4">
          Your request to join is awaiting approval.
        </p>
        <button
          onClick={leave}
          disabled={loading}
          className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-40"
        >
          {loading ? 'Cancelling…' : 'Cancel request'}
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      <h3 className="font-bold text-gray-900 mb-4">Join this club</h3>
      <p className="text-sm text-gray-500 mb-5">
        Become a member to get early access to events, exclusive content, and connect with the community.
      </p>
      <button
        onClick={join}
        disabled={loading}
        className="btn-primary w-full justify-center disabled:opacity-40"
      >
        {loading ? 'Joining…' : club.isPrivate ? 'Request to join' : `Join ${club.name}`}
      </button>
      <p className="text-center text-xs text-gray-400 mt-3">Free to join</p>
    </div>
  )
}
