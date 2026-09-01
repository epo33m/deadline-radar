export type Course = {
  id: string;
  user_id: string;
  name: string;
  code: string | null;
  color: string | null;
  created_at: string;
  deleted_at: string | null;
};

/** Active course fields used by list/edit UI. */
export type CourseListItem = Pick<Course, "id" | "name" | "code" | "color">;
