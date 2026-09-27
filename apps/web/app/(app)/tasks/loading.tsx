function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-muted ${className ?? ""}`}
    />
  );
}

export default function TasksLoading() {
  return (
    <section className="space-y-2" aria-busy="true" aria-label="Loading tasks">
      <SkeletonBlock className="h-9 w-32 sm:h-10 sm:w-40 lg:h-11" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="rounded-lg border border-hairline bg-canvas p-4"
          >
            <div className="flex items-center gap-3">
              <SkeletonBlock className="h-5 w-5 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBlock className="h-5 w-3/4" />
                <SkeletonBlock className="h-4 w-1/3" />
              </div>
              <SkeletonBlock className="h-6 w-16 shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
