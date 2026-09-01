import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TaskDetailPanel } from "@/components/tasks/task-detail";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/types/course";
import type { ReminderThreshold, Task } from "@/types/task";

type TaskDetailRow = Task & {
  courses:
    | Pick<Course, "name" | "code" | "color">
    | Pick<Course, "name" | "code" | "color">[]
    | null;
};

type TaskDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: task, error: taskError }, { data: courses, error: coursesError }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, user_id, course_id, title, description, deadline, status, estimated_duration, created_at, updated_at, deleted_at, courses(name, code, color)",
        )
        .eq("id", id)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle()
        .returns<TaskDetailRow>(),
      supabase
        .from("courses")
        .select("id, name, code, color")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .returns<Pick<Course, "id" | "name" | "code" | "color">[]>(),
    ]);

  if (taskError || coursesError) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Task</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load this task. Apply the tasks migration in Supabase if you
          have not already.
        </p>
      </section>
    );
  }

  if (!task) {
    notFound();
  }

  const { data: thresholds, error: thresholdsError } = await supabase
    .from("reminder_thresholds")
    .select("id, task_id, days_before, is_default, created_at")
    .eq("task_id", task.id)
    .order("days_before", { ascending: false })
    .returns<ReminderThreshold[]>();

  const course = Array.isArray(task.courses) ? task.courses[0] : task.courses;

  // If the assigned course was soft-deleted, keep it selectable so the form can
  // still submit until the user picks another active course.
  const courseOptions = [...(courses ?? [])];
  if (
    course &&
    !courseOptions.some((option) => option.id === task.course_id)
  ) {
    courseOptions.unshift({
      id: task.course_id,
      name: `${course.name} (removed)`,
      code: course.code,
      color: course.color,
    });
  }

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <p className="text-sm">
          <Link href="/tasks" className="text-primary hover:underline">
            ← Tasks
          </Link>
        </p>
        <h1 className="font-display text-3xl font-semibold">{task.title}</h1>
      </div>

      {thresholdsError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load reminder thresholds.
        </p>
      ) : null}

      <TaskDetailPanel
        task={{
          ...task,
          course_name: course?.name ?? null,
          course_code: course?.code ?? null,
          course_color: course?.color ?? null,
        }}
        courses={courseOptions}
        thresholds={thresholds ?? []}
      />
    </section>
  );
}
