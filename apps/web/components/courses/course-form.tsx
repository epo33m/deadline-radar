"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import {
  createCourse,
  updateCourse,
  type CourseActionState,
} from "@/app/actions/courses";
import { ColorPicker } from "@/components/courses/color-picker";
import { IconPicker } from "@/components/courses/icon-picker";
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
  formCardClassName,
  formSectionGapClassName,
} from "@/components/ui/dialog-form";
import { Input } from "@/components/ui/input";
import { normalizeCourseColorForStorage } from "@/lib/courses/colors";
import { normalizeCourseIconForStorage } from "@/lib/courses/icons";
import { generateIdempotencyKey } from "@/lib/api/idempotency";
import { cn } from "@/lib/utils";
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
  const [idempotencyKey] = useState(() => generateIdempotencyKey());
  const [state, formAction, pending] = useActionState(action, initialState);
  const [name, setName] = useState(course?.name ?? "");
  const [code, setCode] = useState(course?.code ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [color, setColor] = useState(() =>
    normalizeCourseColorForStorage(course?.color),
  );
  const [icon, setIcon] = useState(() =>
    normalizeCourseIconForStorage(course?.icon),
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
  const descriptionId = `${formId}-description`;
  const colorId = `${formId}-color`;
  const iconId = `${formId}-icon`;

  return (
    <form
      id={formId}
      action={formAction}
      className="flex w-full flex-col"
      aria-busy={pending}
    >
      {course ? (
        <input type="hidden" name="id" value={course.id} />
      ) : (
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      )}
      <input type="hidden" name="color" value={color} />
      <input type="hidden" name="icon" value={icon} />

      <div className={cn("w-full", formSectionGapClassName)}>
        <ul className={dialogFormListClassName}>
          <li className="py-1.5">
            <Input
              id={nameId}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Title"
              required
              aria-invalid={Boolean(state.fieldErrors?.name)}
              className={cn(dialogInputClassName, "text-left")}
            />
          </li>

          <li className="py-1.5">
            <Input
              id={codeId}
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Code"
              aria-invalid={Boolean(state.fieldErrors?.code)}
              className={cn(dialogInputClassName, "text-left")}
            />
          </li>

          <li className="py-1.5">
            <textarea
              id={descriptionId}
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description"
              rows={3}
              aria-invalid={Boolean(state.fieldErrors?.description)}
              className="w-full rounded-none border-0 bg-transparent px-0 py-1 font-sans text-[15px] font-normal leading-relaxed tracking-[-0.2px] text-ink shadow-none outline-none placeholder:text-ink-muted-48 focus-visible:border-0 focus-visible:ring-0 focus-visible:outline-none aria-invalid:text-destructive"
            />
          </li>
        </ul>

        <ul className={cn("w-full list-none divide-y divide-divider-soft", formCardClassName)}>
          <DialogFormRow label="Color" htmlFor={colorId}>
            <ColorPicker
              id={colorId}
              value={color}
              onChange={setColor}
              compact
            />
          </DialogFormRow>
          <DialogFormRow label="Icon" htmlFor={iconId}>
            <IconPicker
              id={iconId}
              value={icon}
              onChange={setIcon}
              compact
            />
          </DialogFormRow>
        </ul>
      </div>

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