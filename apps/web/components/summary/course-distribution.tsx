export type CourseDistributionSlice = {
  course: string;
  tasks: number;
  /** Solid fill per course color (canonical hex). */
  fill: string;
};

/** Fallback fills when a course has no stored color. */
const FALLBACK_FILLS = [
  "#0088ff",
  "#34c759",
  "#ff8d28",
  "#cb30e0",
  "#ff383c",
  "#6155f5",
];

export function toDistributionSlices(
  courses: { name: string; color: string | null; tasks: number }[],
): CourseDistributionSlice[] {
  return courses.map((slice, index) => ({
    course: slice.name,
    tasks: slice.tasks,
    fill:
      slice.color && /^#[0-9a-f]{6}$/i.test(slice.color)
        ? slice.color
        : FALLBACK_FILLS[index % FALLBACK_FILLS.length],
  }));
}

export function CourseDistributionCaption({
  total,
  courseCount,
}: {
  total: number;
  courseCount: number;
}) {
  return (
    <p className="shrink-0 text-[15px] text-ink-muted-64">
      {total} task{total === 1 ? "" : "s"} across {courseCount} course
      {courseCount === 1 ? "" : "s"}
    </p>
  );
}

export function CourseDistributionBars({
  slices,
}: {
  slices: CourseDistributionSlice[];
}) {
  const total = slices.reduce((sum, slice) => sum + slice.tasks, 0);
  const safeTotal = total > 0 ? total : 1;
  const summary = slices
    .map((slice) => `${slice.course}: ${slice.tasks}`)
    .join(", ");

  if (slices.length === 0) {
    return (
      <p className="text-[15px] text-ink-muted-64">
        No active tasks across courses.
      </p>
    );
  }

  return (
    <div className="w-full">
      <div
        role="img"
        aria-label={`Task distribution across courses — ${summary}`}
        className="flex h-4 w-full overflow-hidden rounded-xs bg-ink/10"
      >
        {slices.map((slice) => (
          <div
            key={slice.course}
            className="h-full"
            style={{
              width: `${(slice.tasks / safeTotal) * 100}%`,
              background: slice.fill,
            }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {slices.map((slice) => (
          <li
            key={slice.course}
            className="flex items-center gap-2 text-[13px] text-ink-muted-64"
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ background: slice.fill }}
            />
            {slice.course}
          </li>
        ))}
      </ul>
    </div>
  );
}
