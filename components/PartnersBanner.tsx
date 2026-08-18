'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'

interface Partner {
  id: string
  name: string
  category: string
  discount: string
  neighborhood: string
  logo: string | null
}

export default function PartnersBanner() {
  const [partners, setPartners] = useState<Partner[]>([])

  useEffect(() => {
    fetch('/app/api/partners', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setPartners(Array.isArray(d) ? d.slice(0, 8) : []))
      .catch(() => {})
  }, [])

  if (!partners.length) return null

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
        <div>
          <h3 className="font-bold text-gray-900 text-sm">Member Perks 🎁</h3>
          <p className="text-xs text-gray-400 mt-0.5">Exclusive discounts from local partners</p>
        </div>
        <Link href="/perks"
          className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors">
          See all →
        </Link>
      </div>

      {/* Partner logos strip */}
      <div className="px-4 py-4 flex flex-wrap items-center justify-center gap-3">
        {partners.map(p => {
          const logo = resolveImageUrl(p.logo)
          return (
            <Link key={p.id} href="/perks"
              className="flex flex-col items-center gap-1.5 shrink-0 group">
              <div className="w-14 h-14 rounded-2xl border border-gray-100 bg-gray-50 flex items-center justify-center overflow-hidden group-hover:border-amber-200 group-hover:shadow-sm transition-all">
                {logo
                  ? <img src={logo} alt={p.name} className="w-full h-full object-cover" />
                  : <span className="text-xl">🏪</span>
                }
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-gray-700 truncate max-w-[56px]">{p.name.split(' ')[0]}</p>
                <p className="text-[9px] text-amber-600 font-bold truncate max-w-[56px]">{p.discount.split(' ').slice(0, 2).join(' ')}</p>
              </div>
            </Link>
          )
        })}

        {/* View all tile */}
        <Link href="/perks"
          className="flex flex-col items-center gap-1.5 shrink-0 group">
          <div className="w-14 h-14 rounded-2xl border border-dashed border-amber-200 bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
            <span className="text-amber-500 text-xl">→</span>
          </div>
          <p className="text-xs font-semibold text-amber-600">All perks</p>
        </Link>
      </div>
    </div>
  )
}
