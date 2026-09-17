import { CalendarMonthView } from "@/components/calendar/calendar-month-view";
import { LearnSecondaryNav } from "@/components/learn/learn-secondary-nav";
import { PageHeader } from "@/components/ui/page-header";
import { apiJson } from "@/lib/api/server";
import { requireSession } from "@/lib/api/session";
import {
  buildMonthGrid,
  getZonedDayKey,
  groupTasksByDay,
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

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const { month: monthParam } = await searchParams;
  const user = await requireSession();
  const timeZone = user.timezone;
  const month = parseMonthParam(monthParam, timeZone);
  const todayKey = getZonedDayKey(new Date().toISOString(), timeZone) ?? "";

  const result = await apiJson<{ tasks?: ApiTask[] }>("/api/v1/tasks");
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
        cells={cells}
        tasksByDay={tasksByDay}
      />
    </section>
  );
}
