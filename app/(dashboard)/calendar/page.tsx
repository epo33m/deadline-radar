import { redirect } from "next/navigation";

import { CalendarMonthView } from "@/components/calendar/calendar-month-view";
import {
  buildMonthGrid,
  getZonedDayKey,
  groupTasksByDay,
  parseMonthParam,
  type CalendarTask,
} from "@/lib/calendar/month";
import { createClient } from "@/lib/supabase/server";
import type { Course } from "@/types/course";
import type { Task } from "@/types/task";

type TaskRow = Pick<Task, "id" | "title" | "deadline" | "status"> & {
  courses: Pick<Course, "name" | "color"> | Pick<Course, "name" | "color">[] | null;
};

type CalendarPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const { month: monthParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Calendar</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load your profile timezone.
        </p>
      </section>
    );
  }

  const timeZone = profile?.timezone ?? "UTC";
  const month = parseMonthParam(monthParam, timeZone);
  const todayKey = getZonedDayKey(new Date().toISOString(), timeZone) ?? "";

  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id, title, deadline, status, courses(name, color)")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .returns<TaskRow[]>();

  if (tasksError) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Calendar</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load calendar deadlines. Apply the tasks migration in Supabase
          if you have not already.
        </p>
      </section>
    );
  }

  const calendarTasks: CalendarTask[] = (tasks ?? []).map((task) => {
    const course = Array.isArray(task.courses) ? task.courses[0] : task.courses;
    return {
      id: task.id,
      title: task.title,
      deadline: task.deadline,
      status: task.status,
      course_name: course?.name ?? null,
      course_color: course?.color ?? null,
    };
  });

  const tasksByDay = groupTasksByDay(calendarTasks, timeZone);
  const cells = buildMonthGrid(month.year, month.month, timeZone);

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Calendar</h1>
        <p className="text-ink-muted-48">
          Monthly view of your task deadlines in {timeZone}.
        </p>
      </div>

      <CalendarMonthView
        month={month}
        timeZone={timeZone}
        todayKey={todayKey}
        cells={cells}
        tasksByDay={tasksByDay}
      />
    </section>
  );
}
