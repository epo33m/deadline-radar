/**
 * Progress stats — the canonical definition shared by every consumer.
 *
 * Semantics (single source of truth):
 * - `total` counts every non-deleted task; `completed` counts `done` ones.
 * - On-time means a `done` task whose `completedAt` instant is at or before
 *   its deadline. A `done` task with missing/unparseable `completedAt` or
 *   deadline can never count as on-time, but still counts toward
 *   `onTimeTotal` (= `completed`).
 * - `courses` aggregates ACTIVE (non-done) tasks per course, sorted by task
 *   count descending. Tasks whose course is missing fall back to
 *   "Uncategorized".
 */

export type ProgressCourseSlice = {
  name: string;
  color: string | null;
  tasks: number;
};

export type ProgressSummary = {
  completed: number;
  total: number;
  onTime: number;
  onTimeTotal: number;
  courses: ProgressCourseSlice[];
};

export type ProgressTask = {
  status: string;
  deadline: string;
  completedAt: string | null;
  courseName: string | null;
  courseColor: string | null;
};

export function summarizeProgress(tasks: ProgressTask[]): ProgressSummary {
  let completed = 0;
  let onTime = 0;
  const byCourse = new Map<string, ProgressCourseSlice>();

  for (const task of tasks) {
    if (task.status === "done") {
      completed += 1;

      if (task.completedAt !== null) {
        const completedMs = new Date(task.completedAt).getTime();
        const deadlineMs = new Date(task.deadline).getTime();
        if (
          !Number.isNaN(completedMs) &&
          !Number.isNaN(deadlineMs) &&
          completedMs <= deadlineMs
        ) {
          onTime += 1;
        }
      }
      continue;
    }

    const key = task.courseName ?? "Uncategorized";
    const existing = byCourse.get(key);
    if (existing) {
      existing.tasks += 1;
    } else {
      byCourse.set(key, {
        name: key,
        color: task.courseColor ?? null,
        tasks: 1,
      });
    }
  }

  const courses = [...byCourse.values()].sort((a, b) => b.tasks - a.tasks);

  return {
    completed,
    total: tasks.length,
    onTime,
    onTimeTotal: completed,
    courses,
  };
}
