function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-muted ${className ?? ""}`}
    />
  );
}

export default function CourseDetailLoading() {
  return (
    <section
      className="space-y-6"
      aria-busy="true"
      aria-label="Loading course details"
    >
      <div className="flex items-center gap-4">
        <SkeletonBlock className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBlock className="h-8 w-1/2" />
          <SkeletonBlock className="h-4 w-32" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-lg border border-hairline bg-canvas p-4"
          >
            <SkeletonBlock className="h-5 w-3/4" />
          </div>
        ))}
      </div>
    </section>
  );
}
