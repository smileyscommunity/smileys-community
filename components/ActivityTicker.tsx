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
    <div className="relative bg-amber-500 overflow-hidden py-2.5 select-none">
      <div className="flex animate-ticker whitespace-nowrap">
        {doubled.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 px-6 text-sm font-medium text-white shrink-0">
            <span>{item.emoji}</span>
            <span>{item.text}</span>
            <span className="mx-3 text-amber-300 font-bold">·</span>
          </span>
        ))}
      </div>
    </div>
  )
}
