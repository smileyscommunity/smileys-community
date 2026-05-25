'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

// Bulk-add tool for seeding the marketplace. The user (admin) pastes 10-20 listings
// in a labelled-block format, previews the parsed result, then creates them in one
// transaction. Each batch shares a category + attribution user — keeps the UI simple
// since 90% of seeding will be one batch of housing posts.

const CATEGORIES = [
  { id: 'ROOMS',    label: '🏠 Rooms & Housing' },
  { id: 'JOBS',     label: '💼 Jobs & Gigs'     },
  { id: 'SERVICES', label: '🛠️ Services'        },
  { id: 'BUY_SELL', label: '🛍️ Buy & Sell'      },
  { id: 'FREE',     label: '🎁 Free stuff'      },
  { id: 'RECO',     label: '⭐ Recommendations' },
]

interface ParsedItem {
  title:       string
  description: string
  price?:      string
  contact?:    string
}

const PLACEHOLDER = `Beautiful 1+1 flat in Moda — walking distance to ferry
Price: 25000 TL/month
Contact: +90 555 123 4567 (WhatsApp)
Furnished, top floor, big balcony with sea view. Available May 1.
Building has elevator. Cats welcome, no dogs.

---

Shared room near Boğaziçi University
Price: 9000 TL/month
Contact: housing@example.com
Quiet international house, 4 roommates total. Private bedroom, shared kitchen.
Bills included. 6-month minimum.`

// Parse the textarea into structured listings. Convention:
//   - Listings separated by --- on its own line
//   - First non-blank line = title
//   - Lines like "Price: ..." or "Contact: ..." extracted to those fields
//   - Everything else joined as description
function parse(raw: string): ParsedItem[] {
  const blocks = raw.split(/^---\s*$/m).map(b => b.trim()).filter(Boolean)
  return blocks.map(block => {
    const lines = block.split('\n').map(l => l.trim())
    let title: string | undefined
    let price: string | undefined
    let contact: string | undefined
    const descLines: string[] = []
    for (const line of lines) {
      if (!line) continue
      const priceMatch = /^Price\s*[:\-]\s*(.+)$/i.exec(line)
      const contactMatch = /^Contact\s*[:\-]\s*(.+)$/i.exec(line)
      if (priceMatch) { price = priceMatch[1].trim(); continue }
      if (contactMatch) { contact = contactMatch[1].trim(); continue }
      if (!title) { title = line; continue }
      descLines.push(line)
    }
    return {
      title:       title ?? '',
      description: descLines.join('\n').trim(),
      price,
      contact,
    }
  })
}

export default function BulkAddListingsPage() {
  const router = useRouter()
  const [category, setCategory]               = useState('ROOMS')
  const [attributedUserId, setAttributedUserId] = useState('')
  const [raw, setRaw]                         = useState('')
  const [submitting, setSubmitting]           = useState(false)

  const items = parse(raw)
  const validItems = items.filter(i => i.title && i.description)
  const invalidItems = items.filter(i => !i.title || !i.description)

  async function handleSubmit() {
    if (validItems.length === 0) {
      toast.error('Nothing to submit — paste some listings first')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/app/api/admin/listings/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          attributedUserId: attributedUserId.trim() || undefined,
          items: validItems,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to create listings')
        return
      }
      toast.success(`Created ${data.created} listing${data.created !== 1 ? 's' : ''}`)
      router.push('/admin/listings')
    } catch {
      toast.error('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/listings" className="text-zinc-400 hover:text-zinc-100 text-sm">← Listings</Link>
        </div>

        <h1 className="text-2xl font-bold mb-1">Bulk-add listings</h1>
        <p className="text-sm text-zinc-400 mb-8">
          Paste 1–50 listings, separated by <code className="text-zinc-300 bg-zinc-800 px-1 rounded">---</code> on its own line. Format per block:{' '}
          <code className="text-zinc-300 bg-zinc-800 px-1 rounded">Title</code> on the first line,{' '}
          <code className="text-zinc-300 bg-zinc-800 px-1 rounded">Price:</code> and{' '}
          <code className="text-zinc-300 bg-zinc-800 px-1 rounded">Contact:</code> optional, everything else is description.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm">
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
              Post as user ID <span className="text-zinc-500 font-normal">(default: you)</span>
            </label>
            <input value={attributedUserId} onChange={e => setAttributedUserId(e.target.value)}
              placeholder="Paste user ID for cleaner attribution"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono" />
          </div>
        </div>

        <textarea
          value={raw}
          onChange={e => setRaw(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={18}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed"
        />

        {items.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-zinc-300">
                Preview ({validItems.length} valid{invalidItems.length > 0 ? `, ${invalidItems.length} invalid` : ''})
              </h2>
            </div>
            <div className="space-y-2">
              {items.map((item, i) => {
                const valid = item.title && item.description
                return (
                  <div key={i} className={`border rounded-lg p-3 ${valid ? 'border-zinc-800 bg-zinc-900' : 'border-red-900 bg-red-950/30'}`}>
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <p className="font-semibold text-sm text-zinc-100">{item.title || <span className="text-red-400">(missing title)</span>}</p>
                      {item.price && <span className="text-xs font-semibold text-green-400 shrink-0">{item.price}</span>}
                    </div>
                    {item.description ? (
                      <p className="text-xs text-zinc-400 whitespace-pre-wrap line-clamp-3">{item.description}</p>
                    ) : (
                      <p className="text-xs text-red-400">(missing description)</p>
                    )}
                    {item.contact && <p className="text-xs text-zinc-500 mt-1.5 font-mono">📞 {item.contact}</p>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button onClick={handleSubmit} disabled={submitting || validItems.length === 0}
            className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {submitting ? 'Creating…' : `Create ${validItems.length} listing${validItems.length !== 1 ? 's' : ''}`}
          </button>
          {invalidItems.length > 0 && (
            <p className="text-xs text-red-400">{invalidItems.length} item{invalidItems.length !== 1 ? 's' : ''} will be skipped (missing title or description)</p>
          )}
        </div>
      </div>
    </div>
  )
}
