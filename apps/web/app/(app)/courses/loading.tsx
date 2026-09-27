function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-muted ${className ?? ""}`}
    />
  );
}

export default function CoursesLoading() {
  return (
    <section className="space-y-2" aria-busy="true" aria-label="Loading courses">
      <SkeletonBlock className="h-9 w-36 sm:h-10 sm:w-44 lg:h-11" />
      <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="rounded-lg border border-hairline bg-canvas p-4 sm:p-5"
          >
            <div className="flex items-center gap-3">
              <SkeletonBlock className="h-10 w-10 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBlock className="h-5 w-2/3" />
                <SkeletonBlock className="h-4 w-1/3" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
