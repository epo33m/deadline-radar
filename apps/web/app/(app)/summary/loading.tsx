function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-muted ${className ?? ""}`}
    />
  );
}

function SkeletonCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas p-4 sm:p-6">{children}</div>
  );
}

export default function SummaryLoading() {
  return (
    <section className="space-y-6 sm:space-y-8" aria-busy="true" aria-label="Loading summary">
      <div className="space-y-2 sm:space-y-3">
        <SkeletonBlock className="h-8 w-28 sm:h-9 sm:w-32 lg:h-11" />
        <SkeletonBlock className="h-[17px] w-56 max-w-full sm:h-[21px] sm:w-72" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        {Array.from({ length: 4 }).map((_, sectionIndex) => (
          <SkeletonCard key={sectionIndex}>
            <div className="space-y-4">
              <SkeletonBlock className="h-6 w-32" />
              <div className="space-y-3 border-t border-hairline pt-3">
                {Array.from({ length: 2 }).map((__, rowIndex) => (
                  <SkeletonBlock key={rowIndex} className="h-12 w-full" />
                ))}
              </div>
            </div>
          </SkeletonCard>
        ))}
      </div>
    </section>
  );
}
