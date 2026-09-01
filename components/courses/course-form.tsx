"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  createCourse,
  updateCourse,
  type CourseActionState,
} from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CourseListItem } from "@/types/course";
import { isHexColor } from "@/lib/validation/course";

const initialState: CourseActionState = {};

type CourseFormProps = {
  course?: CourseListItem;
  onSuccess?: () => void;
  submitLabel: string;
};

export function CourseForm({ course, onSuccess, submitLabel }: CourseFormProps) {
  const action = course ? updateCourse : createCourse;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [name, setName] = useState(course?.name ?? "");
  const [code, setCode] = useState(course?.code ?? "");
  const [color, setColor] = useState(course?.color ?? "");
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      onSuccess?.();
    }
    wasPending.current = pending;
  }, [pending, state.error, onSuccess]);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      {course ? <input type="hidden" name="id" value={course.id} /> : null}
      <div className="space-y-2">
        <Label htmlFor={course ? `name-${course.id}` : "name"}>Name</Label>
        <Input
          id={course ? `name-${course.id}` : "name"}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          aria-invalid={Boolean(state.fieldErrors?.name)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={course ? `code-${course.id}` : "code"}>
          Code <span className="text-ink-muted-48">(optional)</span>
        </Label>
        <Input
          id={course ? `code-${course.id}` : "code"}
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="CS101"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={course ? `color-${course.id}` : "color"}>
          Color <span className="text-ink-muted-48">(optional hex)</span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id={course ? `color-${course.id}` : "color"}
            name="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            placeholder="#0066cc"
            aria-invalid={Boolean(state.fieldErrors?.color)}
          />
          <input
            type="color"
            aria-label="Pick color"
            className="h-9 w-10 cursor-pointer rounded-md border border-hairline bg-transparent p-1"
            value={isHexColor(color) ? color : "#0066cc"}
            onChange={(event) => setColor(event.target.value)}
          />
          {color ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setColor("")}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Remounts on success so the create form clears without setState-in-effect. */
export function AddCourseForm() {
  const [formKey, setFormKey] = useState(0);
  return (
    <CourseForm
      key={formKey}
      submitLabel="Add course"
      onSuccess={() => setFormKey((current) => current + 1)}
    />
  );
}
