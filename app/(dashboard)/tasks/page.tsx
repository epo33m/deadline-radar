import Link from "next/link";
import { redirect } from "next/navigation";

import { AddTaskForm } from "@/components/tasks/task-form";
import { TaskList } from "@/components/tasks/task-list";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/types/course";
import type { Task, TaskListItem } from "@/types/task";

type TaskRow = Pick<
  Task,
  | "id"
  | "course_id"
  | "title"
  | "deadline"
  | "status"
  | "estimated_duration"
> & {
  courses: Pick<Course, "name" | "color"> | Pick<Course, "name" | "color">[] | null;
};

export default async function TasksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: courses, error: coursesError }, { data: tasks, error: tasksError }] =
    await Promise.all([
      supabase
        .from("courses")
        .select("id, name, code, color")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .returns<Pick<Course, "id" | "name" | "code" | "color">[]>(),
      supabase
        .from("tasks")
        .select(
          "id, course_id, title, deadline, status, estimated_duration, courses(name, color)",
        )
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("deadline", { ascending: true })
        .returns<TaskRow[]>(),
    ]);

  if (coursesError || tasksError) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Tasks</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load tasks. Apply the courses and tasks migrations in
          Supabase if you have not already.
        </p>
      </section>
    );
  }

  const listItems: TaskListItem[] = (tasks ?? []).map((task) => {
    const course = Array.isArray(task.courses) ? task.courses[0] : task.courses;
    return {
      id: task.id,
      course_id: task.course_id,
      title: task.title,
      deadline: task.deadline,
      status: task.status,
      estimated_duration: task.estimated_duration,
      course_name: course?.name ?? null,
      course_color: course?.color ?? null,
    };
  });

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Tasks</h1>
        <p className="text-ink-muted-48">
          Create tasks with a course and deadline. Default reminder thresholds
          (H-7 / H-3 / H-1 / H-0) are generated automatically.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">Add task</h2>
        {(courses ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted-48">
            You need an active course first.{" "}
            <Link href="/courses" className="text-primary hover:underline">
              Create a course
            </Link>
            .
          </p>
        ) : (
          <AddTaskForm courses={courses ?? []} />
        )}
      </div>

      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">Your tasks</h2>
        <TaskList tasks={listItems} />
      </div>
    </section>
  );
}
