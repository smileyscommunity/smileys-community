interface TickerItem {
  emoji: string
  text: string
}

interface Props {
  items: TickerItem[]
}

export default function ActivityTicker({ items }: Props) {
  if (!items.length) return null

  const doubled = [...items, ...items]

  return (
    <div
      className="relative bg-amber-500 overflow-hidden py-2.5 select-none ticker-container"
      tabIndex={0}
      role="region"
      aria-label="Community activity"
    >
      {/* Visual ticker — hidden from screen readers (duplicated content is confusing) */}
      <div className="flex animate-ticker whitespace-nowrap" aria-hidden="true">
        {doubled.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 px-6 text-sm font-medium text-white shrink-0">
            <span>{item.emoji}</span>
            <span>{item.text}</span>
            <span className="mx-3 text-white/50">·</span>
          </span>
        ))}
      </div>

      {/* Screen-reader list — unique items only */}
      <ul className="sr-only">
        {items.map((item, i) => (
          <li key={i}>{item.emoji} {item.text}</li>
        ))}
      </ul>
    </div>
  )
}
