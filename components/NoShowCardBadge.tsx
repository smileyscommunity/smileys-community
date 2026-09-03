// The one place a host sees another event's no-show card: next to a name in
// the approval queue, where it informs a decision. Counts only — never the
// events, never the history — and nothing at all when there is no active
// card, so the common case renders empty rather than "✓ clean".
export default function NoShowCardBadge({ cards }: { cards?: { yellow: number; red: number } | null }) {
  if (!cards || (cards.yellow === 0 && cards.red === 0)) return null
  const red = cards.red > 0
  const n   = red ? cards.red : cards.yellow
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${
        red ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      }`}
      title={red
        ? `${n} active red card${n !== 1 ? 's' : ''} — RSVPs are paused for this member`
        : `${n} active yellow card${n !== 1 ? 's' : ''} — registered for a free event and didn't check in`}
    >
      <span aria-hidden="true">{red ? '🟥' : '🟨'}</span>
      {n} active card{n !== 1 ? 's' : ''}
    </span>
  )
}
