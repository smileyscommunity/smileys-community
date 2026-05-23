export default function ClubCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-card p-5 flex gap-4 animate-pulse">
      <div className="h-20 w-20 shrink-0 rounded-xl bg-gray-200" />
      <div className="flex-1 min-w-0 space-y-2.5">
        <div className="h-4 bg-gray-200 rounded-full w-3/4" />
        <div className="h-3 bg-gray-200 rounded-full w-full" />
        <div className="h-3 bg-gray-200 rounded-full w-2/3" />
        <div className="flex items-center justify-between pt-1">
          <div className="h-3 bg-gray-200 rounded-full w-20" />
          <div className="h-7 bg-gray-200 rounded-lg w-16" />
        </div>
      </div>
    </div>
  )
}
