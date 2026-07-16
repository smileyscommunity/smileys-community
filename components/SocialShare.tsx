'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface Props {
  title: string
  url: string
  /** Short token appended to the WhatsApp/Facebook share URL to bust cached link previews */
  cacheKey?: string
  /** Icon row only — no card chrome or label. For embedding inside an
      existing action row (e.g. the directory detail header). */
  compact?: boolean
}

export default function SocialShare({ title, url, cacheKey, compact }: Props) {
  const [copied, setCopied] = useState(false)

  // Append cacheKey so social crawlers that already cached an old preview are forced to re-scrape
  const shareUrl    = cacheKey ? `${url}?v=${cacheKey}` : url
  const encodedUrl  = encodeURIComponent(shareUrl)
  const encodedText = encodeURIComponent(`${title} — ${shareUrl}`)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy link')
    }
  }

  const btnCls = compact
    ? 'w-9 h-9 flex items-center justify-center rounded-full text-white transition-colors'
    : 'flex-1 flex items-center justify-center py-2.5 rounded-xl text-white transition-colors'
  const copyCls = compact
    ? 'w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors'
    : 'flex-1 flex items-center justify-center py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors'

  const buttons = (
    <>
      {/* WhatsApp */}
      <a href={`https://wa.me/?text=${encodedText}`}
        target="_blank" rel="noopener noreferrer" title="Share on WhatsApp"
        className={`${btnCls} bg-[#25D366] hover:bg-[#1ebe5d]`}>
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </a>

      {/* Facebook */}
      <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
        target="_blank" rel="noopener noreferrer" title="Share on Facebook"
        className={`${btnCls} bg-[#1877F2] hover:bg-[#0d6ae0]`}>
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </a>

      {/* X / Twitter */}
      <a href={`https://twitter.com/intent/tweet?text=${encodedText}`}
        target="_blank" rel="noopener noreferrer" title="Share on X"
        className={`${btnCls} bg-black hover:bg-zinc-800`}>
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>

      {/* Copy link */}
      <button onClick={copyLink} title="Copy link" className={copyCls}>
        {copied ? (
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        )}
      </button>
    </>
  )

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" aria-label="Share">
        {buttons}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Share</p>
      <div className="flex gap-2">
        {buttons}
      </div>
    </div>
  )
}
