import { CoursesManagement } from "@/components/courses/courses-management";
import { apiJson } from "@/lib/api/server";
import { requireSession } from "@/lib/api/session";
import type { Course } from "@/types/course";

type ApiCourse = {
  id: string;
  userId: string;
  name: string;
  code: string | null;
  color: string | null;
  icon?: string | null;
  description: string | null;
  createdAt: string | Date;
  deletedAt: string | Date | null;
};

function mapCourse(row: ApiCourse): Course {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    code: row.code,
    color: row.color,
    icon: row.icon ?? null,
    description: row.description,
    created_at:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    deleted_at:
      row.deletedAt instanceof Date
        ? row.deletedAt.toISOString()
        : (row.deletedAt ?? null),
  };
}

export default async function CoursesPage() {
  // Overlap the session RTT with the data fetch; the redirect still wins
  // for unauthenticated viewers because it is awaited before render.
  const sessionPromise = requireSession();

  const result = await apiJson<{ courses?: ApiCourse[]; error?: string }>(
    "/api/v1/courses",
  );

  await sessionPromise;

  if (result.error || !result.courses) {
    return (
      <section className="space-y-2">
        <h1 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">Courses</h1>
        <p className="text-sm text-destructive" role="alert">
          Could not load courses. Ensure the API is running and migrations are
          applied.
        </p>
      </section>
    );
  }

  return <CoursesManagement courses={result.courses.map(mapCourse)} />;
}
