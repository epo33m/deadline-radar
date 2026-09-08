import { OverviewSummariesPanel } from "@/components/overview/overview-summaries";
import { apiJson } from "@/lib/api/server";
import { requireSession } from "@/lib/api/session";
import { getOverviewGreeting, getOverviewTagline } from "@/lib/overview/greeting";
import {
  categorizeOverviewTasks,
  type OverviewTask,
} from "@/lib/overview/summaries";

type ApiTask = {
  id: string;
  title: string;
  deadline: string | Date;
  status: OverviewTask["status"];
  updatedAt?: string | Date;
  courseName: string | null;
  courseColor: string | null;
};

export default async function OverviewPage() {
  const user = await requireSession();
  const result = await apiJson<{ tasks?: ApiTask[] }>("/api/v1/tasks");

  if (result.error || !result.tasks) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">Overview</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load overview summaries. Ensure the API is running.
        </p>
      </section>
    );
  }

  const now = new Date();
  const overviewTasks: OverviewTask[] = result.tasks.map((task) => ({
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

  const summaries = categorizeOverviewTasks(overviewTasks, now);

  return (
    <section className="space-y-6 sm:space-y-8">
      <div className="space-y-2 sm:space-y-3">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
          {getOverviewGreeting()}
        </h1>
        <p className="text-[17px] font-normal leading-[1.47] tracking-[-0.374px] text-ink-muted-64 sm:text-[21px] sm:leading-[1.19] sm:tracking-[0.231px]">
          {getOverviewTagline()}
        </p>
      </div>

      <OverviewSummariesPanel summaries={summaries} timeZone={user.timezone} />
    </section>
  );
}
