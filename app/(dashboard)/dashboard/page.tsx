import { redirect } from "next/navigation";

import { DashboardSummariesPanel } from "@/components/dashboard/dashboard-summaries";
import { getOverviewGreeting, getOverviewTagline } from "@/lib/dashboard/greeting";
import {
  categorizeDashboardTasks,
  type DashboardTask,
} from "@/lib/dashboard/summaries";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/types/course";
import type { Task } from "@/types/task";

type TaskRow = Pick<
  Task,
  "id" | "title" | "deadline" | "status" | "updated_at"
> & {
  courses: Pick<Course, "name" | "color"> | Pick<Course, "name" | "color">[] | null;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: tasks, error }, { data: profile }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, deadline, status, updated_at, courses(name, color)")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .returns<TaskRow[]>(),
    supabase
      .from("profiles")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (error) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Overview</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load overview summaries. Apply the tasks migration in
          Supabase if you have not already.
        </p>
      </section>
    );
  }

  const timeZone = profile?.timezone ?? "UTC";
  const now = new Date();

  const dashboardTasks: DashboardTask[] = (tasks ?? []).map((task) => {
    const course = Array.isArray(task.courses) ? task.courses[0] : task.courses;
    return {
      id: task.id,
      title: task.title,
      deadline: task.deadline,
      status: task.status,
      updated_at: task.updated_at,
      course_name: course?.name ?? null,
      course_color: course?.color ?? null,
    };
  });

  const summaries = categorizeDashboardTasks(dashboardTasks, now);
  const greeting = getOverviewGreeting();
  const tagline = getOverviewTagline();

  return (
    <section className="space-y-6 sm:space-y-8">
      <div className="space-y-2 sm:space-y-3">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          {greeting}
        </h1>
        <p className="text-[17px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-48 sm:text-[21px] sm:leading-[1.19] sm:tracking-[0.231px]">
          {tagline}
        </p>
      </div>

      <DashboardSummariesPanel summaries={summaries} timeZone={timeZone} />
    </section>
  );
}
