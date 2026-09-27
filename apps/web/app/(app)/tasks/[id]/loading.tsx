function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-muted ${className ?? ""}`}
    />
  );
}

export default function TaskDetailLoading() {
  return (
    <section
      className="space-y-6"
      aria-busy="true"
      aria-label="Loading task details"
    >
      <div className="space-y-2">
        <SkeletonBlock className="h-8 w-2/3 sm:h-9" />
        <SkeletonBlock className="h-4 w-40" />
      </div>
      <div className="rounded-lg border border-hairline bg-canvas p-4 sm:p-6">
        <div className="space-y-4">
          <SkeletonBlock className="h-5 w-full" />
          <SkeletonBlock className="h-5 w-5/6" />
          <SkeletonBlock className="h-5 w-2/3" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonBlock className="h-32 w-full" />
        <SkeletonBlock className="h-32 w-full" />
      </div>
    </section>
  );
}
