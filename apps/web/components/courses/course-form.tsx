"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import {
  createCourse,
  updateCourse,
  type CourseActionState,
} from "@/app/actions/courses";
import { ColorPicker } from "@/components/courses/color-picker";
import { Button } from "@/components/ui/button";
import {
  dialogActionsClassName,
  dialogPrimaryActionClassName,
  dialogSecondaryActionClassName,
} from "@/components/ui/dialog";
import {
  DialogFormRow,
  dialogFormListClassName,
  dialogInputClassName,
} from "@/components/ui/dialog-form";
import { Input } from "@/components/ui/input";
import { normalizeCourseColorForStorage } from "@/lib/courses/colors";
import type { CourseListItem } from "@/types/course";

const initialState: CourseActionState = {};

type CourseFormProps = {
  course?: CourseListItem;
  onSuccess?: () => void;
  onCancel?: () => void;
  submitLabel: string;
};

export function CourseForm({
  course,
  onSuccess,
  onCancel,
  submitLabel,
}: CourseFormProps) {
  const formId = useId();
  const action = course ? updateCourse : createCourse;
  const [state, formAction, pending] = useActionState(action, initialState);
  const [name, setName] = useState(course?.name ?? "");
  const [code, setCode] = useState(course?.code ?? "");
  const [color, setColor] = useState(() =>
    normalizeCourseColorForStorage(course?.color),
  );
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      onSuccess?.();
    }
    wasPending.current = pending;
  }, [pending, state.error, onSuccess]);

  const nameId = `${formId}-name`;
  const codeId = `${formId}-code`;
  const colorId = `${formId}-color`;

  return (
    <form
      id={formId}
      action={formAction}
      className="flex w-full flex-col"
      aria-busy={pending}
    >
      {course ? <input type="hidden" name="id" value={course.id} /> : null}
      <input type="hidden" name="color" value={color} />

      <ul className={dialogFormListClassName}>
        <DialogFormRow label="Name" htmlFor={nameId}>
          <Input
            id={nameId}
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            aria-invalid={Boolean(state.fieldErrors?.name)}
            className={dialogInputClassName}
          />
        </DialogFormRow>

        <DialogFormRow label="Code" htmlFor={codeId}>
          <Input
            id={codeId}
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-invalid={Boolean(state.fieldErrors?.code)}
            className={dialogInputClassName}
          />
        </DialogFormRow>

        <DialogFormRow label="Color" htmlFor={colorId}>
          <ColorPicker
            id={colorId}
            value={color}
            onChange={setColor}
            compact
          />
        </DialogFormRow>
      </ul>

      {state.error ? (
        <p className="pt-4 text-center text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={dialogActionsClassName}>
        <Button
          type="submit"
          disabled={pending}
          className={dialogPrimaryActionClassName}
        >
          {pending ? "Saving…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            className={dialogSecondaryActionClassName}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Remounts on success so the create form clears without setState-in-effect. */
export function AddCourseForm({
  onSuccess,
  onCancel,
}: {
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const [formKey, setFormKey] = useState(0);

  return (
    <CourseForm
      key={formKey}
      submitLabel="Save"
      onCancel={onCancel}
      onSuccess={() => {
        setFormKey((current) => current + 1);
        onSuccess?.();
      }}
    />
  );
}