import { redirect } from "next/navigation";

import { AddCourseForm } from "@/components/courses/course-form";
import { CourseList } from "@/components/courses/course-list";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/types/course";

export default async function CoursesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, user_id, name, code, color, created_at, deleted_at")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .returns<Course[]>();

  if (error) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Courses</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load courses. Apply the courses migration in Supabase if you
          have not already.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Courses</h1>
        <p className="text-ink-muted-48">
          Create and manage courses to organize tasks. Names do not need to be
          unique.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">Add course</h2>
        <AddCourseForm />
      </div>

      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">Your courses</h2>
        <CourseList courses={courses ?? []} />
      </div>
    </section>
  );
}
