import { notFound } from "next/navigation";

import { CourseDetail } from "@/components/courses/course-detail";
import { ListPager } from "@/components/ui/list-pager";
import { requireBootstrap } from "@/lib/api/bootstrap";
import { getCourse } from "@/lib/api/course";
import { apiJson } from "@/lib/api/server";
import { withPageCount } from "@/lib/paging/href";
import { LIST_PAGE_LIMIT } from "@/lib/paging/limit";
import { loadPaged } from "@/lib/paging/load-pages";
import { parsePageCount } from "@/lib/paging/page-count";
import type { Course } from "@/types/course";
import type { Task } from "@/types/task";

type CourseDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; pages?: string | string[] }>;
};

type ApiTask = {
  id: string;
  title: string;
  deadline: string | Date;
  status: Task["status"];
  updatedAt?: string | Date;
};

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** One page of this course's tasks, with an explicit `limit` (#141). */
function fetchCourseTaskPage(courseId: string) {
  return async (cursor: string | null): Promise<{
    items: ApiTask[];
    nextCursor: string | null;
  }> => {
    const qs = new URLSearchParams({
      courseId,
      limit: String(LIST_PAGE_LIMIT),
    });
    if (cursor) qs.set("cursor", cursor);

    const result = await apiJson<{
      tasks?: ApiTask[];
      page?: { nextCursor?: string | null };
      error?: string;
    }>(`/api/v1/tasks?${qs.toString()}`);

    if (result.error) throw new Error(result.error);

    return {
      items: result.tasks ?? [],
      nextCursor: result.page?.nextCursor ?? null,
    };
  };
}

export async function generateMetadata({ params }: CourseDetailPageProps) {
  const { id } = await params;
  const result = await getCourse(id);
  return { title: result.course?.name ?? "Course" };
}

export default async function CourseDetailPage({
  params,
  searchParams,
}: CourseDetailPageProps) {
  const [{ id }, { view, pages: rawPages }, { user }] = await Promise.all([
    params,
    searchParams,
    requireBootstrap(),
  ]);

  const pageCount = parsePageCount(rawPages);

  const [courseResult, tasksPaged] = await Promise.all([
    getCourse(id),
    loadPaged(fetchCourseTaskPage(id)),
  ]);

  if (courseResult.error === "Course not found") {
    notFound();
  }

  if (courseResult.error || !courseResult.course) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-3xl font-semibold">Course</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load this course. Ensure the API is running.
        </p>
      </section>
    );
  }

  const c = courseResult.course;
  const course: Course = {
    id: c.id,
    user_id: c.userId,
    name: c.name,
    code: c.code,
    color: c.color,
    icon: c.icon ?? null,
    description: c.description,
    created_at: iso(c.createdAt)!,
    deleted_at: iso(c.deletedAt),
  };

  const tasks = tasksPaged.items.map((t) => ({
    id: t.id,
    title: t.title,
    deadline: iso(t.deadline)!,
    status: t.status,
    updated_at: iso(t.updatedAt ?? t.deadline)!,
  }));

  const validViews = ["upcoming", "overdue", "done"] as const;
  const taskView = validViews.includes(view as typeof validViews[number]) 
    ? (view as typeof validViews[number]) 
    : "all";

  return (
    <CourseDetail
      course={course}
      tasks={tasks}
      timeZone={user.timezone}
      timeFormat={user.timeFormat}
      taskView={taskView}
      nowIso={new Date().toISOString()}
      // Hidden when the walk failed on the first page: then the list is
      // unknown, and an empty course would read as "this course has no tasks".
      pager={
        tasks.length > 0 ? (
          <ListPager
            loadedCount={tasks.length}
            nextPageHref={
              tasksPaged.nextCursor
                ? // `view` must survive paging: the task filter lives in the URL.
                  withPageCount(`/courses/${id}`, { view }, pageCount + 1)
                : undefined
            }
            truncated={tasksPaged.truncated}
            note={
              tasksPaged.error != null
                ? "Some tasks couldn't be loaded. Try again."
                : undefined
            }
            noun="task"
            nounPlural="tasks"
          />
        ) : null
      }
    />
  );
}
