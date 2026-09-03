import { notFound, redirect } from "next/navigation";

import { CourseDetail } from "@/components/courses/course-detail";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/types/course";
import type { Task } from "@/types/task";

type CourseDetailPageProps = {
  params: Promise<{ id: string }>;
};

type TaskRow = Pick<
  Task,
  "id" | "title" | "deadline" | "status" | "updated_at"
>;

export async function generateMetadata({ params }: CourseDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { title: "Course" };
  }

  const { data: course } = await supabase
    .from("courses")
    .select("name")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  return { title: course?.name ?? "Course" };
}

export default async function CourseDetailPage({
  params,
}: CourseDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [
    { data: course, error: courseError },
    { data: tasks, error: tasksError },
    { data: profile },
  ] = await Promise.all([
    supabase
      .from("courses")
      .select("id, user_id, name, code, color, created_at, deleted_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle()
      .returns<Course>(),
    supabase
      .from("tasks")
      .select("id, title, deadline, status, updated_at")
      .eq("user_id", user.id)
      .eq("course_id", id)
      .is("deleted_at", null)
      .returns<TaskRow[]>(),
    supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (courseError || tasksError) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Course</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load this course. Apply the courses and tasks migrations in
          Supabase if you have not already.
        </p>
      </section>
    );
  }

  if (!course) {
    notFound();
  }

  const timeZone = profile?.timezone ?? "UTC";
  const listItems = (tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    deadline: task.deadline,
    status: task.status,
    updated_at: task.updated_at,
  }));

  return (
    <CourseDetail
      course={{
        id: course.id,
        name: course.name,
        code: course.code,
        color: course.color,
      }}
      tasks={listItems}
      timeZone={timeZone}
    />
  );
}
