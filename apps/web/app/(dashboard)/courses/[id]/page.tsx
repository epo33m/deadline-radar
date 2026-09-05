import { notFound } from "next/navigation";

import { CourseDetail } from "@/components/courses/course-detail";
import { apiJson } from "@/lib/api/server";
import { requireSession } from "@/lib/api/session";
import type { Course } from "@/types/course";
import type { Task } from "@/types/task";

type CourseDetailPageProps = {
  params: Promise<{ id: string }>;
};

type ApiCourse = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  color: string | null;
  createdAt: string | Date;
  deletedAt: string | Date | null;
};

type ApiTask = {
  id: string;
  title: string;
  deadline: string | Date;
  status: Task["status"];
  updatedAt?: string | Date;
};

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function generateMetadata({ params }: CourseDetailPageProps) {
  const { id } = await params;
  const result = await apiJson<{ course?: { name: string } }>(
    `/api/courses/${id}`,
  );
  return { title: result.course?.name ?? "Course" };
}

export default async function CourseDetailPage({
  params,
}: CourseDetailPageProps) {
  const { id } = await params;
  const user = await requireSession();

  const [courseResult, tasksResult] = await Promise.all([
    apiJson<{ course?: ApiCourse; error?: string }>(`/api/courses/${id}`),
    apiJson<{ tasks?: ApiTask[] }>(`/api/tasks?courseId=${id}`),
  ]);

  if (courseResult.error === "Course not found") {
    notFound();
  }

  if (courseResult.error || !courseResult.course) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Course</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load this course. Ensure the API is running.
        </p>
      </section>
    );
  }

  const c = courseResult.course;
  const course: Course = {
    id: c.id,
    user_id: c.userId,
    name: c.name,
    code: c.code,
    color: c.color,
    created_at: iso(c.createdAt)!,
    deleted_at: iso(c.deletedAt),
  };

  const tasks = (tasksResult.tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    deadline: iso(t.deadline)!,
    status: t.status,
    updated_at: iso(t.updatedAt ?? t.deadline)!,
  }));

  return (
    <CourseDetail course={course} tasks={tasks} timeZone={user.timezone} />
  );
}
