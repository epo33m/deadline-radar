import Link from "next/link";
import { notFound } from "next/navigation";

import { TaskDetailPanel } from "@/components/tasks/task-detail";
import { apiJson } from "@/lib/api/server";
import { requireSession } from "@/lib/api/session";
import type { Course } from "@/types/course";
import type { Attachment, ReminderThreshold, Task } from "@/types/task";

type TaskDetailPageProps = {
  params: Promise<{ id: string }>;
};

type ApiTask = {
  id: string;
  userId: string;
  courseId: string;
  title: string;
  description: string | null;
  deadline: string | Date;
  status: Task["status"];
  estimatedDuration: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
};

type ApiCourse = {
  id: string;
  name: string;
  code: string | null;
  color: string | null;
};

type ApiThreshold = {
  id: string;
  taskId: string;
  daysBefore: number;
  isDefault: boolean;
  createdAt: string | Date;
};

type ApiAttachment = {
  id: string;
  taskId: string;
  type: Attachment["type"];
  name: string;
  storagePath: string | null;
  url: string | null;
  createdAt: string | Date;
};

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { id } = await params;
  const user = await requireSession();

  const [detailResult, coursesResult] = await Promise.all([
    apiJson<{
      task?: ApiTask;
      course?: ApiCourse | null;
      thresholds?: ApiThreshold[];
      attachments?: ApiAttachment[];
      error?: string;
    }>(`/api/v1/tasks/${id}`),
    apiJson<{ courses?: ApiCourse[] }>("/api/v1/courses"),
  ]);

  if (detailResult.error === "Task not found") {
    notFound();
  }

  if (detailResult.error || !detailResult.task) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Task</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load this task. Ensure the API is running.
        </p>
      </section>
    );
  }

  const task = detailResult.task;
  const course = detailResult.course;
  const courses = coursesResult.courses ?? [];

  const courseOptions: Pick<Course, "id" | "name" | "code" | "color">[] =
    courses.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      color: c.color,
    }));

  if (course && !courseOptions.some((option) => option.id === task.courseId)) {
    courseOptions.unshift({
      id: task.courseId,
      name: `${course.name} (removed)`,
      code: course.code,
      color: course.color,
    });
  }

  const thresholds: ReminderThreshold[] = (detailResult.thresholds ?? []).map(
    (t) => ({
      id: t.id,
      task_id: t.taskId,
      days_before: t.daysBefore,
      is_default: t.isDefault,
      created_at: iso(t.createdAt)!,
    }),
  );

  const attachments: Attachment[] = (detailResult.attachments ?? []).map(
    (a) => ({
      id: a.id,
      task_id: a.taskId,
      type: a.type,
      name: a.name,
      storage_path: a.storagePath,
      url: a.url,
      created_at: iso(a.createdAt)!,
    }),
  );

  const mappedTask = {
    id: task.id,
    user_id: task.userId,
    course_id: task.courseId,
    title: task.title,
    description: task.description,
    deadline: iso(task.deadline)!,
    status: task.status,
    estimated_duration: task.estimatedDuration,
    created_at: iso(task.createdAt)!,
    updated_at: iso(task.updatedAt)!,
    deleted_at: iso(task.deletedAt),
    course_name: course?.name ?? null,
    course_code: course?.code ?? null,
    course_color: course?.color ?? null,
  };

  return (
    <section className="space-y-6 sm:space-y-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link href="/tasks" className="text-primary hover:underline">
            ← Tasks
          </Link>
        </p>
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">{task.title}</h1>
      </div>

      <TaskDetailPanel
        task={mappedTask}
        courses={courseOptions}
        thresholds={thresholds}
        attachments={attachments}
        timeZone={user.timezone}
      />
    </section>
  );
}
