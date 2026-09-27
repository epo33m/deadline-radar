import { CoursesManagement } from "@/components/courses/courses-management";
import { requireBootstrap } from "@/lib/api/bootstrap";
import type { BootstrapCourse } from "@/lib/api/bootstrap";
import type { Course } from "@/types/course";

function mapCourse(row: BootstrapCourse): Course {
  return {
    id: row.id,
    user_id: row.userId,
    name: row.name,
    code: row.code,
    color: row.color,
    icon: row.icon,
    description: row.description,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export default async function CoursesPage() {
  // Bootstrap (React-cached with the layout) is the only request this page
  // needs. Uncursored, capped at 200 — a strict superset of the old
  // default-limit-50 list call.
  const { courses } = await requireBootstrap();

  return <CoursesManagement courses={courses.map(mapCourse)} />;
}
