"use client";

import {
  cloneElement,
  isValidElement,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  createCourse,
  updateCourse,
  type CourseActionState,
} from "@/app/actions/courses";
import { ColorPicker } from "@/components/courses/color-picker";
import { FieldInfoButton, FieldInfoProvider } from "@/components/courses/field-info-button";
import { Button } from "@/components/ui/button";
import {
  dialogActionsClassName,
  dialogPrimaryActionClassName,
  dialogSecondaryActionClassName,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { normalizeCourseColorForStorage } from "@/lib/courses/colors";
import { cn } from "@/lib/utils";
import type { CourseListItem } from "@/types/course";

const initialState: CourseActionState = {};

const DIALOG_FIELD_HEIGHT = "min-h-11 h-11";
const DIALOG_FIELD_GAP_Y = "gap-y-3";

const dialogFieldShellClassName = cn(
  DIALOG_FIELD_HEIGHT,
  "w-full rounded-full border border-hairline bg-canvas",
);

const dialogInputClassName = cn(
  dialogFieldShellClassName,
  "px-4 font-sans text-[15px] font-normal leading-normal tracking-[-0.2px] text-ink shadow-none placeholder:text-ink-muted-48 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 aria-invalid:border-destructive aria-invalid:ring-destructive/20",
);

const dialogInputWithInfoClassName = cn(dialogInputClassName, "pr-11");

const dialogSelectClassName = cn(
  dialogInputClassName,
  "cursor-pointer appearance-none pr-[3.625rem] outline-none",
);

const dialogFieldsClassName = cn("flex w-full flex-col", DIALOG_FIELD_GAP_Y);

function DialogFieldControl({
  info,
  children,
}: {
  info?: string;
  children: ReactNode;
}) {
  const helpId = useId();

  const field = info && isValidElement(children)
    ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
        "aria-describedby": [
          (children as ReactElement<{ "aria-describedby"?: string }>).props[
            "aria-describedby"
          ],
          helpId,
        ]
          .filter(Boolean)
          .join(" "),
      })
    : children;

  return (
    <div className={cn("relative min-w-0", DIALOG_FIELD_HEIGHT)}>
      {info ? (
        <span id={helpId} className="sr-only">
          {info}
        </span>
      ) : null}
      {field}
      {info ? (
        <div className="pointer-events-none absolute inset-y-0 right-2.5 z-10 flex items-center">
          <FieldInfoButton info={info} />
        </div>
      ) : null}
    </div>
  );
}

type CourseFormProps = {
  course?: CourseListItem;
  onSuccess?: () => void;
  onCancel?: () => void;
  submitLabel: string;
  namePlaceholder?: string;
};

export function CourseForm({
  course,
  onSuccess,
  onCancel,
  submitLabel,
  namePlaceholder = "Name",
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

      <div className={cn("mt-4", dialogFieldsClassName)}>
        <FieldInfoProvider>
          <DialogFieldControl info="The display name for this course.">
            <Input
              id={nameId}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={namePlaceholder}
              required
              aria-invalid={Boolean(state.fieldErrors?.name)}
              className={dialogInputWithInfoClassName}
            />
          </DialogFieldControl>

          <DialogFieldControl info="An optional short code, such as CS101.">
            <Input
              id={codeId}
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Code"
              className={dialogInputWithInfoClassName}
            />
          </DialogFieldControl>

          <ColorPicker
            id={colorId}
            value={color}
            onChange={setColor}
            info="Pick a color to help identify this course in lists."
            className={dialogSelectClassName}
          />
        </FieldInfoProvider>
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
  namePlaceholder = "Name",
}: {
  onSuccess?: () => void;
  onCancel?: () => void;
  namePlaceholder?: string;
}) {
  const [formKey, setFormKey] = useState(0);

  return (
    <CourseForm
      key={formKey}
      submitLabel="Save"
      namePlaceholder={namePlaceholder}
      onCancel={onCancel}
      onSuccess={() => {
        setFormKey((current) => current + 1);
        onSuccess?.();
      }}
    />
  );
}
