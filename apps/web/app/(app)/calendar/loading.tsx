function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-muted ${className ?? ""}`}
    />
  );
}

export default function CalendarLoading() {
  return (
    <section className="space-y-6 sm:space-y-8" aria-busy="true" aria-label="Loading calendar">
      <SkeletonBlock className="h-9 w-44 sm:h-10" />
      <div className="rounded-lg border border-hairline bg-canvas p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <SkeletonBlock className="h-6 w-32" />
          <div className="flex gap-2">
            <SkeletonBlock className="h-8 w-8" />
            <SkeletonBlock className="h-8 w-8" />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {Array.from({ length: 35 }).map((_, index) => (
            <SkeletonBlock key={index} className="h-12 sm:h-20" />
          ))}
        </div>
      </div>
    </section>
  );
}
