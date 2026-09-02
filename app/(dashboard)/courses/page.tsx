import { redirect } from "next/navigation";

import { CoursesManagement } from "@/components/courses/courses-management";
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

  return <CoursesManagement courses={courses ?? []} />;
}
