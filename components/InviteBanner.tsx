'use client'

import Link from 'next/link'

interface Props {
  variant?: 'card' | 'strip'
}

export default function InviteBanner({ variant = 'card' }: Props) {
  if (variant === 'strip') {
    return (
      <Link href="/invite" className="group block">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 to-orange-400 px-5 py-4 flex items-center justify-between gap-4">
          {/* Decorative circles */}
          <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/10" />
          <div className="absolute -bottom-6 right-12 w-16 h-16 rounded-full bg-white/10" />

          <div className="relative z-10 flex items-center gap-3">
            <span className="text-2xl">🎁</span>
            <div>
              <p className="text-sm font-bold text-white leading-tight">Know someone who'd fit in?</p>
              <p className="text-xs text-amber-100 mt-0.5">Invite them to join Smileys</p>
            </div>
          </div>
          <span className="relative z-10 shrink-0 text-xs font-bold text-white bg-white/20 group-hover:bg-white/30 transition-colors px-3 py-1.5 rounded-full">
            Invite →
          </span>
        </div>
      </Link>
    )
  }

  return (
    <Link href="/invite" className="group block">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-amber-400 to-orange-400 p-5">
        {/* Decorative shapes */}
        <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute bottom-0 right-8 w-20 h-20 rounded-full bg-white/10" />
        <div className="absolute top-4 right-20 w-8 h-8 rounded-full bg-white/15" />

        <div className="relative z-10">
          <h3 className="text-base font-black text-white leading-tight mb-1">
            Know someone who'd fit in?
          </h3>
          <p className="text-xs text-amber-100 leading-relaxed mb-4">
            Every great community grows through people who care. Invite your friends and help Smileys stay special.
          </p>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 bg-white px-4 py-2 rounded-xl group-hover:bg-amber-50 transition-colors">
            Send an invite
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  )
}
