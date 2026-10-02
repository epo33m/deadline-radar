import type { TaskStatus } from "@/lib/validation/task";

/** Sort weight for the default All view — active tasks first, starting from todo. */
const STATUS_ORDER: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 1,
  done: 2,
};

export function deadlineMs(deadline: string): number {
  const ms = new Date(deadline).getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Default "All" ordering: active first (todo → in progress → done), then
 * nearest deadline first. Callers pre-parse each deadline once (see
 * `compareByStatusThenDeadline`) so the comparator never allocates.
 */
export function compareByStatusThenDeadline(
  a: { status: TaskStatus; deadlineMs: number },
  b: { status: TaskStatus; deadlineMs: number },
): number {
  const orderA = STATUS_ORDER[a.status] ?? 99;
  const orderB = STATUS_ORDER[b.status] ?? 99;
  if (orderA !== orderB) return orderA - orderB;
  return a.deadlineMs - b.deadlineMs;
}

/** Sort (non-mutating) with each deadline parsed exactly once. */
export function sortTasksAllView<T extends { status: TaskStatus; deadline: string }>(
  tasks: T[],
): T[] {
  return [...tasks]
    .map((task) => ({ task, deadlineMs: deadlineMs(task.deadline) }))
    .sort((a, b) =>
      compareByStatusThenDeadline(
        { status: a.task.status, deadlineMs: a.deadlineMs },
        { status: b.task.status, deadlineMs: b.deadlineMs },
      ),
    )
    .map(({ task }) => task);
}
