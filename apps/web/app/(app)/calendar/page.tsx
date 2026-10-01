import { CalendarMonthView } from "@/components/calendar/calendar-month-view";
import { LearnSecondaryNav } from "@/components/learn/learn-secondary-nav";
import { PageHeader } from "@/components/ui/page-header";
import { apiFetch } from "@/lib/api/server";
import { requireSession } from "@/lib/api/session";
import {
  buildMonthGrid,
  getZonedDayKey,
  groupTasksByDay,
  parseMonthParam,
  type CalendarTask,
} from "@/lib/calendar/month";
import { loadCalendarMonth } from "@/lib/calendar/load";

type CalendarPageProps = {
  searchParams: Promise<{ month?: string }>;
};

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

  const result = await loadCalendarMonth(
    (path) => apiFetch(path),
    timeZone,
    month.year,
    month.month,
  );
  if (result.error || !result.tasks) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">Calendar</h1>
        <p className="text-sm text-destructive" role="alert">
          {result.error ?? "Could not load calendar deadlines. Please try again later."}
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
