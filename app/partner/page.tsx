'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { resolveImageUrl } from '@/lib/data'

interface PartnerData {
  id: string
  name: string
  category: string
  discount: string
  address: string
  neighborhood: string
  logo: string | null
  coverImage: string | null
  website: string | null
  instagram: string | null
  isActive: boolean
}

export default function PartnerDashboard() {
  const [partner, setPartner] = useState<PartnerData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/partner', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { setPartner(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-zinc-500 text-sm">Loading...</div>
  if (!partner) return <div className="p-8 text-zinc-500 text-sm">No business data found.</div>

  const logo  = resolveImageUrl(partner.logo)
  const cover = resolveImageUrl(partner.coverImage)

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-3xl">

      <div>
        <h1 className="text-2xl font-extrabold text-white">Welcome, {partner.name}</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Your business profile — visible to all Smileys members</p>
      </div>

      {/* Profile preview card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="relative h-40 bg-zinc-800">
          {cover ? (
            <img src={cover} alt={partner.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-sm">No cover image</div>
          )}
          <div className="absolute top-3 right-3 bg-amber-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">
            {partner.discount}
          </div>
        </div>
        <div className="px-5 py-4 flex items-start gap-4">
          {logo ? (
            <img src={logo} alt={partner.name} className="w-14 h-14 rounded-xl object-cover shrink-0 border-2 border-zinc-700 -mt-7 bg-zinc-900" />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-zinc-800 border-2 border-zinc-700 flex items-center justify-center text-2xl shrink-0 -mt-7">🏪</div>
          )}
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2">
              <p className="font-bold text-white truncate">{partner.name}</p>
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${partner.isActive ? 'bg-green-500/15 text-green-400' : 'bg-zinc-700 text-zinc-500'}`}>
                {partner.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="text-xs text-zinc-500">{partner.category} · {partner.neighborhood}</p>
            <p className="text-xs text-zinc-600 mt-0.5">📍 {partner.address}</p>
          </div>
        </div>

        {/* Links */}
        {(partner.website || partner.instagram) && (
          <div className="px-5 pb-4 flex gap-3">
            {partner.website && (
              <a href={partner.website} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                {partner.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            )}
            {partner.instagram && (
              <a href={`https://instagram.com/${partner.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-pink-400 hover:text-pink-300 transition-colors">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
                {partner.instagram.startsWith('@') ? partner.instagram : `@${partner.instagram}`}
              </a>
            )}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/partner/settings"
          className="bg-zinc-900 border border-zinc-800 hover:border-amber-500/50 rounded-2xl p-4 transition-colors group">
          <div className="text-xl mb-2">✏️</div>
          <p className="text-sm font-bold text-white group-hover:text-amber-400 transition-colors">Edit Profile</p>
          <p className="text-xs text-zinc-500 mt-0.5">Update info, discount, links</p>
        </Link>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="text-xl mb-2">📊</div>
          <p className="text-sm font-bold text-white">Stats</p>
          <p className="text-xs text-zinc-500 mt-0.5">Coming soon</p>
        </div>
      </div>

      {/* Missing info nudges */}
      {(!partner.logo || !partner.coverImage || !partner.website || !partner.instagram) && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
          <p className="text-xs font-bold text-amber-400 mb-2">Complete your profile</p>
          <ul className="space-y-1">
            {!partner.logo       && <li className="text-xs text-zinc-400">• Add a logo so members recognise you</li>}
            {!partner.coverImage && <li className="text-xs text-zinc-400">• Add a cover photo to stand out</li>}
            {!partner.instagram  && <li className="text-xs text-zinc-400">• Add your Instagram so members can follow you</li>}
            {!partner.website    && <li className="text-xs text-zinc-400">• Add your website for more info</li>}
          </ul>
          <Link href="/partner/settings" className="inline-block mt-3 text-xs font-bold text-amber-400 hover:text-amber-300">
            Go to Settings →
          </Link>
        </div>
      )}
    </div>
  )
}
