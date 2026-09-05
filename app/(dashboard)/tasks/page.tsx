import { redirect } from "next/navigation";

import { TasksCollection } from "@/components/tasks/tasks-collection";
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

  const [
    { data: courses, error: coursesError },
    { data: tasks, error: tasksError },
    { data: profile },
  ] = await Promise.all([
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
    supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle(),
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

  const timeZone = profile?.timezone ?? "UTC";

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
    <TasksCollection
      courses={courses ?? []}
      tasks={listItems}
      timeZone={timeZone}
    />
  );
}
