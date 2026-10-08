import { TasksCollection } from "@/components/tasks/tasks-collection";
import { ListPager } from "@/components/ui/list-pager";
import { requireBootstrap } from "@/lib/api/bootstrap";
import { apiJson } from "@/lib/api/server";
import { withPageCount } from "@/lib/paging/href";
import { LIST_PAGE_LIMIT } from "@/lib/paging/limit";
import { loadPaged } from "@/lib/paging/load-pages";
import { parsePageCount } from "@/lib/paging/page-count";
import type { Course } from "@/types/course";
import type { TaskListItem } from "@/types/task";

type TasksPageProps = {
  searchParams: Promise<{ pages?: string | string[] }>;
};

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

/**
 * Fetch one page of tasks.
 *
 * `limit` is explicit rather than left to the API default so the page size the
 * pager assumes (`LIST_PAGE_LIMIT`) is the page size actually requested (#141).
 */
async function fetchTaskPage(cursor: string | null): Promise<{
  items: ApiTask[];
  nextCursor: string | null;
}> {
  const qs = new URLSearchParams({ limit: String(LIST_PAGE_LIMIT) });
  if (cursor) qs.set("cursor", cursor);

  const result = await apiJson<{
    tasks?: ApiTask[];
    page?: { nextCursor?: string | null };
    error?: string;
  }>(`/api/v1/tasks?${qs.toString()}`);

  if (result.error) {
    // Thrown, not swallowed: the page renders a load error rather than an empty
    // list that reads as "you have no tasks".
    throw new Error(result.error);
  }

  return { items: result.tasks ?? [], nextCursor: result.page?.nextCursor ?? null };
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  // One bootstrap call (React-cached with the layout) covers user +
  // courses; only the task list needs its own request. The redirect still
  // wins for unauthenticated viewers because bootstrap is awaited first.
  const bootstrapPromise = requireBootstrap();

  const { pages: rawPages } = await searchParams;
  const pageCount = parsePageCount(rawPages);

  // Started before awaiting bootstrap so the two run concurrently.
  const tasksPromise = loadPaged(fetchTaskPage);

  const { user, courses: bootstrapCourses } = await bootstrapPromise;
  const paged = await tasksPromise;

  // A failure on the very first page means we know nothing about the list:
  // rendering it empty would read as "you have no tasks".
  if (paged.error != null && paged.items.length === 0) {
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

  const listItems: TaskListItem[] = paged.items.map((task) => ({
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
      pager={
        listItems.length > 0 ? (
          <ListPager
            loadedCount={listItems.length}
            nextPageHref={
              paged.nextCursor ? withPageCount("/tasks", {}, pageCount + 1) : undefined
            }
            truncated={paged.truncated}
            note={
              paged.error != null
                ? "Some tasks couldn't be loaded. Try again."
                : undefined
            }
            noun="task"
            nounPlural="tasks"
            className="px-1"
          />
        ) : null
      }
    />
  );
}
