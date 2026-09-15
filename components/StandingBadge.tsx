// A member's standing, on a pending request only — the one place it informs a
// host's decision: on a scarce event a red card is why the request is here at
// all. Nothing renders in good standing, or while standing is switched off
// (the participants API sends no level then).
export default function StandingBadge({ level }: { level?: 'yellow' | 'red' | null }) {
  if (!level) return null
  const red = level === 'red'
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${
        red ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      }`}
      title={red
        ? 'Red card — seats at small events need your approval for this member'
        : 'Yellow card — recent missed commitments on small events'}
    >
      <span aria-hidden="true">{red ? '🟥' : '🟨'}</span>
      {red ? 'Red card' : 'Yellow card'}
    </span>
  )
}
