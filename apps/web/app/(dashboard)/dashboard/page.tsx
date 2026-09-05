import { DashboardSummariesPanel } from "@/components/dashboard/dashboard-summaries";
import { apiJson } from "@/lib/api/server";
import { requireSession } from "@/lib/api/session";
import { getOverviewGreeting, getOverviewTagline } from "@/lib/dashboard/greeting";
import {
  categorizeDashboardTasks,
  type DashboardTask,
} from "@/lib/dashboard/summaries";

type ApiTask = {
  id: string;
  title: string;
  deadline: string | Date;
  status: DashboardTask["status"];
  updatedAt?: string | Date;
  courseName: string | null;
  courseColor: string | null;
};

export default async function DashboardPage() {
  const user = await requireSession();
  const result = await apiJson<{ tasks?: ApiTask[] }>("/api/v1/tasks");

  if (result.error || !result.tasks) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Overview</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load overview summaries. Ensure the API is running.
        </p>
      </section>
    );
  }

  const now = new Date();
  const dashboardTasks: DashboardTask[] = result.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    deadline:
      task.deadline instanceof Date
        ? task.deadline.toISOString()
        : String(task.deadline),
    status: task.status,
    updated_at:
      task.updatedAt instanceof Date
        ? task.updatedAt.toISOString()
        : String(task.updatedAt ?? task.deadline),
    course_name: task.courseName,
    course_color: task.courseColor,
  }));

  const summaries = categorizeDashboardTasks(dashboardTasks, now);

  return (
    <section className="space-y-6 sm:space-y-8">
      <div className="space-y-2 sm:space-y-3">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          {getOverviewGreeting()}
        </h1>
        <p className="text-[17px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-48 sm:text-[21px] sm:leading-[1.19] sm:tracking-[0.231px]">
          {getOverviewTagline()}
        </p>
      </div>

      <DashboardSummariesPanel summaries={summaries} timeZone={user.timezone} />
    </section>
  );
}
