export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-200 rounded-lg animate-pulse ${className}`} />
}

export function SkeletonCircle({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-200 rounded-full animate-pulse ${className}`} />
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-2xl shadow-card p-4 animate-pulse ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <SkeletonCircle className="w-10 h-10 shrink-0" />
        <div className="flex-1 space-y-2">
          <SkeletonLine className="h-3 w-1/2" />
          <SkeletonLine className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonLine className="h-3 w-full mb-2" />
      <SkeletonLine className="h-3 w-4/5" />
    </div>
  )
}

export function SkeletonEventCard() {
  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden animate-pulse">
      <div className="h-44 bg-gray-200" />
      <div className="p-4 space-y-2">
        <SkeletonLine className="h-4 w-3/4" />
        <SkeletonLine className="h-3 w-1/2" />
        <SkeletonLine className="h-3 w-2/5" />
      </div>
    </div>
  )
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
