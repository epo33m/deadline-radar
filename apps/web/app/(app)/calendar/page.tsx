import { CalendarMonthView } from "@/components/calendar/calendar-month-view";
import { LearnSecondaryNav } from "@/components/learn/learn-secondary-nav";
import { PageHeader } from "@/components/ui/page-header";
import { apiJson } from "@/lib/api/server";
import { requireSession } from "@/lib/api/session";
import {
  buildMonthGrid,
  getZonedDayKey,
  groupTasksByDay,
  monthVisibleRange,
  parseMonthParam,
  type CalendarTask,
} from "@/lib/calendar/month";

type ApiTask = {
  id: string;
  title: string;
  deadline: string | Date;
  status: CalendarTask["status"];
  courseName: string | null;
  courseColor: string | null;
};

type CalendarPageProps = {
  searchParams: Promise<{ month?: string }>;
};

/** Month-scoped task fetch: visible range only, cursors followed to exhaustion. */
async function fetchMonthTasks(
  timeZone: string,
  year: number,
  month: number,
): Promise<{ tasks?: ApiTask[]; error?: unknown }> {
  const { dueFrom, dueTo } = monthVisibleRange(year, month, timeZone);
  const tasks: ApiTask[] = [];
  let cursor: string | null = null;
  // Safety cap: 10 pages × 200 rows far exceeds any renderable month.
  // Hitting it means SILENT TRUNCATION (partial month renders as complete),
  // so it must be observable: counts-only warn, no PII, wired to the
  // Sentry/log pipeline like the cron outcome line.
  const MAX_PAGES = 10;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const qs = new URLSearchParams({ limit: "200", dueFrom, dueTo });
    if (cursor) qs.set("cursor", cursor);
    const result = await apiJson<{
      tasks?: ApiTask[];
      page?: { nextCursor: string | null };
    }>(`/api/v1/tasks?${qs.toString()}`);
    if (result.error || !result.tasks) return { error: result.error };
    tasks.push(...result.tasks);
    cursor = result.page?.nextCursor ?? null;
    if (!cursor) return { tasks };
  }
  if (cursor) {
    console.warn(
      "[calendar] month fetch hit page cap",
      JSON.stringify({
        year,
        month,
        maxPages: MAX_PAGES,
        pageSize: 200,
        tasksCollected: tasks.length,
      }),
    );
  }
  return { tasks };
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  // searchParams + session are independent — resolve together. The month
  // range fetch below still needs the timezone, so it follows.
  const [{ month: monthParam }, user] = await Promise.all([
    searchParams,
    requireSession(),
  ]);
  const timeZone = user.timezone;
  const month = parseMonthParam(monthParam, timeZone);
  const nowIso = new Date().toISOString();
  const todayKey = getZonedDayKey(nowIso, timeZone) ?? "";

  const result = await fetchMonthTasks(timeZone, month.year, month.month);
  if (result.error || !result.tasks) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">Calendar</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load calendar deadlines. Ensure the API is running.
        </p>
      </section>
    );
  }

  const calendarTasks: CalendarTask[] = result.tasks.map((task) => ({
    id: task.id,
    title: task.title,
    deadline:
      task.deadline instanceof Date
        ? task.deadline.toISOString()
        : String(task.deadline),
    status: task.status,
    course_name: task.courseName,
    course_color: task.courseColor,
  }));

  const tasksByDay = groupTasksByDay(calendarTasks, timeZone);
  const cells = buildMonthGrid(month.year, month.month, timeZone);

  return (
    <section className="space-y-6 sm:space-y-8">
      <LearnSecondaryNav />
      <PageHeader
        title="Calendar"
        subtitle="See your tasks and deadlines at a glance."
      />

      <CalendarMonthView
        month={month}
        timeZone={timeZone}
        timeFormat={user.timeFormat}
        todayKey={todayKey}
        nowIso={nowIso}
        cells={cells}
        tasksByDay={tasksByDay}
      />
    </section>
  );
}
