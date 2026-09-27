// The Handbook's one freshness chip, wherever an article is listed.
//
// One review state used to render four ways: "⏳ Last reviewed <date>" on the
// article and the index, "Review overdue" with the date removed on category
// and stage pages, and a plain "Last reviewed" with no marker in search. The
// category page was telling readers an article was overdue that its own page
// never called overdue. This is the single rendering; every surface passes
// the same reviewLabel() result (lib/handbook-review) and gets the same chip.
//
// `text` null means never reviewed. Listings hide that (absence is the
// signal, and a row of "not yet reviewed" chips reads as a warning wall);
// the article itself says it plainly — pass `showUnreviewed`.
// Server-safe: no hooks, so the client search results can use it too.

export default function ReviewChip({ text, stale, showUnreviewed = false, size = 'sm' }: {
  text: string | null
  stale: boolean
  showUnreviewed?: boolean
  size?: 'sm' | 'xs'
}) {
  const base = size === 'xs'
    ? 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold'
    : 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold'
  if (text === null) {
    if (!showUnreviewed) return null
    return (
      <span className={`${base} bg-gray-100 text-gray-500`}>
        <span aria-hidden="true">○</span> Not yet reviewed
      </span>
    )
  }
  return (
    <span className={`${base} ${stale ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
      <span aria-hidden="true">{stale ? '⏳' : '✓'}</span> {text}
    </span>
  )
}
