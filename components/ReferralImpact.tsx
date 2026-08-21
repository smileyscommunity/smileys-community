'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'

interface Props {
  friendCount: number
  eventCount:  number
}

export default function ReferralImpact({ friendCount, eventCount }: Props) {
  if (friendCount === 0) return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <h2 className="text-sm font-bold text-gray-900 mb-3">Your Impact</h2>
      <div className="text-center py-2">
        <p className="text-xs text-gray-600 leading-relaxed mb-3">
          Invite friends to join Smileys and track how much life you bring to the community!
        </p>
        <Link href="/invite" className="inline-block px-4 py-2 bg-amber-50 text-amber-700 text-xs font-bold rounded-lg hover:bg-amber-100 transition-colors">
          Get your invite code →
        </Link>
      </div>
    </div>
  )

  return (
    <div className="bg-white rounded-2xl shadow-card p-5 overflow-hidden relative group">
      <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
        <span className="text-4xl">✨</span>
      </div>
      
      <h2 className="text-sm font-bold text-gray-900 mb-4">Your Impact</h2>
      
      <div className="grid grid-cols-2 gap-4 relative z-10">
        <div>
          <p className="text-2xl font-black text-amber-500 leading-none">{friendCount}</p>
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mt-1">Friends joined</p>
        </div>
        <div className="border-l border-gray-100 pl-4">
          <p className="text-2xl font-black text-violet-500 leading-none">{eventCount}</p>
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wider mt-1">Events attended</p>
        </div>
      </div>

      <div className="mt-4 p-2.5 bg-gray-50 rounded-xl">
        <p className="text-xs text-gray-600 leading-normal">
          You&apos;ve helped <span className="font-bold text-gray-700">{friendCount} people</span> start their social life here. Great job!
        </p>
      </div>
    </div>
  )
}
