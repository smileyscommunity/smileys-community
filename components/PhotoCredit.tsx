import { isSafeHref } from '@/lib/safeUrl'

// The credit a licensed cover must carry wherever it is shown. A Wikimedia
// Commons photo under CC BY / BY-SA may be used only with its author and
// licence named alongside it, so every surface that renders a listing's cover
// renders this next to it (Business.coverCredit, "Asibala · CC BY-SA 4.0").
// Surfaces that can't show a caption — share cards, JSON-LD — skip a credited
// cover instead (see creditedCoverOk).
//
//   overlay — a small tag on the photo itself
//   line    — a grey line in the card text, for cards whose photo corners are
//             all taken
//
// `link` is off inside cards that are one big <Link> (no nested anchors); the
// listing page links to the source.
export function PhotoCredit({ credit, url, variant, link = false, className = '' }: {
  credit:    string | null | undefined
  url?:      string | null
  variant:   'overlay' | 'line'
  link?:     boolean
  className?: string
}) {
  const text = credit?.trim()
  if (!text) return null
  const label = `Photo: ${text}`
  const style = variant === 'overlay'
    ? 'inline-block max-w-full truncate rounded bg-black/55 px-1.5 py-0.5 text-[10px] leading-tight text-white/90'
    : 'block truncate text-[10px] leading-tight text-gray-400'
  if (link && url && isSafeHref(url) && /^https:\/\//i.test(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title={label}
        className={`${style} hover:underline ${className}`}>
        {label}
      </a>
    )
  }
  return <span title={label} className={`${style} ${className}`}>{label}</span>
}

export { creditedCoverOk } from '@/lib/photoCredit'
