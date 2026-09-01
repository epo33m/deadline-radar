import { redirect } from "next/navigation";

import { DashboardSummariesPanel } from "@/components/dashboard/dashboard-summaries";
import { OverviewMiniCalendar } from "@/components/dashboard/overview-mini-calendar";
import { OverviewStatsGrid } from "@/components/dashboard/overview-stats-grid";
import { UpcomingDeadlinesPanel } from "@/components/dashboard/upcoming-deadlines-panel";
import { getOverviewGreeting } from "@/lib/dashboard/greeting";
import {
  categorizeDashboardTasks,
  type DashboardTask,
} from "@/lib/dashboard/summaries";
import { computeOverviewStats } from "@/lib/dashboard/overview-stats";
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
  const stats = computeOverviewStats(dashboardTasks, now);
  const greeting = getOverviewGreeting(now, timeZone);

  const calendarTasks = dashboardTasks
    .filter((task) => task.status !== "done")
    .map((task) => ({
      id: task.id,
      title: task.title,
      deadline: task.deadline,
      status: task.status,
      course_name: task.course_name,
      course_color: task.course_color,
    }));

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
          Overview
        </h1>
        <p className="text-lg text-ink-muted-48">{greeting}</p>
        <p className="text-sm text-ink-muted-48">
          Here&apos;s what&apos;s happening with your tasks.
        </p>
      </div>

      <OverviewStatsGrid stats={stats} />

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <DashboardSummariesPanel summaries={summaries} timeZone={timeZone} />

        <aside className="space-y-10">
          <OverviewMiniCalendar tasks={calendarTasks} timeZone={timeZone} now={now} />
          <UpcomingDeadlinesPanel
            tasks={summaries.approaching}
            timeZone={timeZone}
          />
        </aside>
      </div>
    </section>
  );
}
