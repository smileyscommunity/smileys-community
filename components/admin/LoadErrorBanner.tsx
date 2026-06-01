// The red Retry banner I've been pasting onto every admin page
// after the audit pattern caught their silent-failure loads.
// Lives here once now.
//
// Usage:
//   <LoadErrorBanner message={error} onRetry={retry} />
//
// The component is a no-op when `message` is null/empty so callers
// don't need to wrap it in their own conditional. Default title is
// generic; pass `title` to scope it ("Couldn't load hosts" etc.).

interface Props {
  message: string | null
  onRetry: () => void
  title?: string
  className?: string
}

export default function LoadErrorBanner({ message, onRetry, title, className }: Props) {
  if (!message) return null
  return (
    <div className={`bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-start gap-3 ${className ?? ''}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-red-300">{title ?? "Couldn't load"}</p>
        <p className="text-xs text-red-400/80 mt-1 break-all">{message}</p>
      </div>
      <button onClick={onRetry}
        className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold shrink-0">
        Retry
      </button>
    </div>
  )
}
