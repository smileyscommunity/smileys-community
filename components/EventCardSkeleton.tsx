export default function EventCardSkeleton() {
  return (
    <div className="card overflow-hidden animate-pulse">
      <div className="h-44 bg-gray-200" />
      <div className="p-5 space-y-3">
        <div className="h-3 bg-gray-200 rounded-full w-32" />
        <div className="space-y-2">
          <div className="h-4 bg-gray-200 rounded-full w-full" />
          <div className="h-4 bg-gray-200 rounded-full w-3/4" />
        </div>
        <div className="h-3 bg-gray-200 rounded-full w-24" />
        <div className="space-y-1.5">
          <div className="h-3 bg-gray-200 rounded-full w-full" />
          <div className="h-3 bg-gray-200 rounded-full w-5/6" />
        </div>
        <div className="h-2 bg-gray-200 rounded-full w-full" />
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <div className="h-4 bg-gray-200 rounded-full w-10" />
          <div className="h-7 bg-gray-200 rounded-lg w-16" />
        </div>
      </div>
    </div>
  )
}
