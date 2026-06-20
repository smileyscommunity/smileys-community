'use client'

import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { neighborhoodToSlug } from '@/lib/neighborhoods'

// Shared list-of-links used by both the desktop avatar dropdown (Navbar.tsx)
// and the mobile bottom sheet (BottomNav.tsx). Anything that's just
// "navigate me to one of my surfaces" lives here so the two shells can stay
// thin chrome.
//
// onItemClick is called after the user picks something — both shells use
// it to close themselves. Sign-out also calls it after logout completes
// so the menu doesn't linger over the redirected page.

const roleBadge: Record<string, string> = {
  admin:     'bg-amber-100 text-amber-700',
  moderator: 'bg-violet-100 text-violet-700',
  member:    'bg-gray-100 text-gray-700',
  partner:   'bg-blue-100 text-blue-700',
}

interface Props {
  onItemClick: () => void
}

export default function AccountMenu({ onItemClick }: Props) {
  const { user, logout } = useAuth()

  return (
    <>
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <p className="text-xs text-gray-600 font-medium mb-0.5">Signed in as</p>
        <p className="text-sm font-bold text-gray-900">{user.name}</p>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleBadge[user.role]}`}>{user.role}</span>
      </div>

      <div className="px-3 pt-2 pb-2 space-y-0.5">
        {user.role === 'admin' && (
          <Link href="/admin" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-amber-600 hover:bg-amber-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Admin Panel
          </Link>
        )}
        {user.role === 'moderator' && (
          <Link href="/admin/moderator" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-violet-600 hover:bg-violet-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            Mod Panel
          </Link>
        )}
        {user.isClubHost && (
          <Link href="/host" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
            Host Panel
          </Link>
        )}

        {(user.role === 'admin' || user.role === 'moderator' || user.isClubHost) && (
          <div className="my-1 h-px bg-gray-100" />
        )}

        {/* Identity */}
        <Link href="/profile" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          Profile
        </Link>
        <Link href="/card" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
          Membership Card
        </Link>

        <div className="my-1 h-px bg-gray-100" />

        {/* High-frequency */}
        <Link href="/messages" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
          Messages
        </Link>
        <Link href="/notifications" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
          Notifications
        </Link>
        <Link href="/my-events" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m-6-2v2M5 9h14M5 11h14M5 19l7-7 7 7" /></svg>
          My Events & Tickets
        </Link>
        <Link href="/hangouts/recap" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8h14a4 4 0 010 8h-1M3 8v8a2 2 0 002 2h10a2 2 0 002-2M3 8l1-2h12l1 2M7 4v2m4-2v2" /></svg>
          Hangouts
        </Link>

        <div className="my-1 h-px bg-gray-100" />

        {/* Social / location */}
        <Link href="/contacts" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          Connections
        </Link>
        <Link href="/profile-visitors" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          Profile Visitors
        </Link>
        {user.neighborhood && (
          <Link href={`/neighborhoods/${neighborhoodToSlug(user.neighborhood)}#wall`} onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            My Neighborhood
          </Link>
        )}

        <div className="my-1 h-px bg-gray-100" />

        {/* Perks / config / growth */}
        <Link href="/perks" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" /></svg>
          Perks
        </Link>
        <Link href="/settings" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          Settings
        </Link>
        <Link href="/invite" onClick={onItemClick} className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Invite a Friend
        </Link>

        <div className="my-1 h-px bg-gray-100" />

        <button onClick={async () => { await logout(); onItemClick() }} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          Sign out
        </button>
      </div>
    </>
  )
}
