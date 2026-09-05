import type { TaskStatus } from "@/lib/validation/task";

export type Task = {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  description: string | null;
  deadline: string;
  status: TaskStatus;
  estimated_duration: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ReminderThreshold = {
  id: string;
  task_id: string;
  days_before: number;
  is_default: boolean;
  created_at: string;
};

export type Attachment = {
  id: string;
  task_id: string;
  type: "file" | "link";
  name: string;
  storage_path: string | null;
  url: string | null;
  created_at: string;
};

/** Active task fields used by list UI. */
export type TaskListItem = Pick<
  Task,
  | "id"
  | "course_id"
  | "title"
  | "deadline"
  | "status"
  | "estimated_duration"
> & {
  course_name?: string | null;
  course_color?: string | null;
};

export type TaskDetail = Task & {
  course_name?: string | null;
  course_color?: string | null;
  course_code?: string | null;
  reminder_thresholds?: ReminderThreshold[];
  attachments?: Attachment[];
};
