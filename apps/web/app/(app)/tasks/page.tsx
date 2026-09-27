import { TasksCollection } from "@/components/tasks/tasks-collection";
import { requireBootstrap } from "@/lib/api/bootstrap";
import { apiJson } from "@/lib/api/server";
import type { Course } from "@/types/course";
import type { TaskListItem } from "@/types/task";

type ApiTask = {
  id: string;
  courseId: string;
  title: string;
  deadline: string | Date;
  status: TaskListItem["status"];
  createdAt: string | Date;
  courseName: string | null;
  courseColor: string | null;
};

export default async function TasksPage() {
  // One bootstrap call (React-cached with the layout) covers user +
  // courses; only the task list needs its own request. The redirect still
  // wins for unauthenticated viewers because bootstrap is awaited first.
  const bootstrapPromise = requireBootstrap();

  const tasksResult = await apiJson<{ tasks?: ApiTask[] }>("/api/v1/tasks");

  const { user, courses: bootstrapCourses } = await bootstrapPromise;

  if (tasksResult.error) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">Tasks</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load tasks. Ensure the API is running and migrations are
          applied.
        </p>
      </section>
    );
  }

  const courses: Pick<Course, "id" | "name" | "code" | "color" | "icon" | "description">[] =
    bootstrapCourses.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      color: c.color,
      icon: c.icon ?? null,
      description: c.description,
    }));

  const listItems: TaskListItem[] = (tasksResult.tasks ?? []).map((task) => ({
    id: task.id,
    course_id: task.courseId,
    title: task.title,
    deadline:
      task.deadline instanceof Date
        ? task.deadline.toISOString()
        : String(task.deadline),
    status: task.status,
    created_at:
      task.createdAt instanceof Date
        ? task.createdAt.toISOString()
        : String(task.createdAt),
    course_name: task.courseName,
    course_color: task.courseColor,
  }));

  return (
    <TasksCollection
      courses={courses}
      tasks={listItems}
      timeZone={user.timezone}
      timeFormat={user.timeFormat}
      nowIso={new Date().toISOString()}
    />
  );
}
