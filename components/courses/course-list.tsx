"use client";

import { useActionState, useState } from "react";

import {
  softDeleteCourse,
  type CourseActionState,
} from "@/app/actions/courses";
import { CourseForm } from "@/components/courses/course-form";
import { Button } from "@/components/ui/button";
import type { CourseListItem } from "@/types/course";

const initialState: CourseActionState = {};

type CourseListProps = {
  courses: CourseListItem[];
};

function SoftDeleteButton({ courseId }: { courseId: string }) {
  const [state, formAction, pending] = useActionState(
    softDeleteCourse,
    initialState,
  );

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="id" value={courseId} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="text-destructive"
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {state.error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function CourseRow({
  course,
}: {
  course: CourseListItem;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="border-b border-hairline py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="mt-1 size-3 shrink-0 rounded-sm border border-hairline"
            style={{
              backgroundColor: course.color ?? "transparent",
            }}
          />
          <div className="min-w-0">
            <p className="font-medium text-ink">{course.name}</p>
            {course.code ? (
              <p className="text-sm text-ink-muted-48">{course.code}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <SoftDeleteButton courseId={course.id} />
        </div>
      </div>
      {editing ? (
        <div className="mt-4">
          <CourseForm
            course={course}
            submitLabel="Save changes"
            onSuccess={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}

export function CourseList({ courses }: CourseListProps) {
  if (courses.length === 0) {
    return (
      <p className="text-sm text-ink-muted-48">
        No courses yet. Add one to assign tasks later.
      </p>
    );
  }

  return (
    <ul className="border-t border-hairline">
      {courses.map((course) => (
        <CourseRow key={course.id} course={course} />
      ))}
    </ul>
  );
}
