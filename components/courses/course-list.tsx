"use client";

import { BookOpen, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  softDeleteCourse,
  type CourseActionState,
} from "@/app/actions/courses";
import { CourseForm } from "@/components/courses/course-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  dialogActionsClassName,
  dialogPrimaryActionClassName,
  dialogSecondaryActionClassName,
} from "@/components/ui/dialog";
import { getCourseColorFill } from "@/lib/courses/colors";
import { cn } from "@/lib/utils";
import type { CourseListItem } from "@/types/course";

const initialState: CourseActionState = {};

type CourseListProps = {
  courses: CourseListItem[];
  onAddCourse?: () => void;
};

type ActionsMenuPosition = {
  top: number;
  left: number;
  minWidth: number;
};

function measureActionsMenuPosition(
  trigger: HTMLButtonElement,
): ActionsMenuPosition {
  const rect = trigger.getBoundingClientRect();
  const minWidth = 160;
  const margin = 8;
  const left = Math.min(
    Math.max(margin, rect.right - minWidth),
    window.innerWidth - minWidth - margin,
  );

  return {
    top: rect.bottom + 4,
    left,
    minWidth,
  };
}

function CourseRow({
  course,
  onEdit,
  onDelete,
}: {
  course: CourseListItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const fillColor = getCourseColorFill(course.color);
  const hasColor = Boolean(fillColor);

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-2 rounded-xl px-3 py-3 sm:gap-3 sm:px-4 sm:py-3.5",
        !hasColor && "border border-hairline bg-canvas",
      )}
      style={hasColor ? { backgroundColor: fillColor ?? undefined } : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px] font-medium leading-snug text-ink dark:text-body-on-dark">
          {course.name}
        </p>
      </div>
      <CourseActionsMenu
        course={course}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </li>
  );
}

function CourseActionsMenu({
  course,
  onEdit,
  onDelete,
}: {
  course: CourseListItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<ActionsMenuPosition | null>(
    null,
  );

  useEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPosition(null);
      return;
    }

    function updatePosition() {
      if (!triggerRef.current) return;
      setMenuPosition(measureActionsMenuPosition(triggerRef.current));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        containerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }

      const items = [editRef.current, deleteRef.current].filter(
        (item): item is HTMLButtonElement => item !== null,
      );
      const currentIndex = items.findIndex((item) => item === document.activeElement);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        items[(currentIndex + 1 + items.length) % items.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        items[(currentIndex - 1 + items.length) % items.length]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const menu =
    open && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            className="fixed z-[70] overflow-hidden rounded-xl border border-hairline bg-canvas p-1 shadow-sm"
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              minWidth: menuPosition.minWidth,
            }}
          >
            <button
              ref={editRef}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <Pencil className="size-4 text-ink-muted-48" aria-hidden="true" />
              Edit
            </button>
            <button
              ref={deleteRef}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label={`Actions for ${course.name}`}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" strokeWidth={2.25} />
      </button>
      {menu}
    </div>
  );
}

function DeleteCourseDialog({
  course,
  open,
  onOpenChange,
}: {
  course: CourseListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState(
    softDeleteCourse,
    initialState,
  );

  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      onOpenChange(false);
    }
    wasPending.current = pending;
  }, [pending, state.error, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete course"
      dismissible={!pending}
    >
      <div className="flex w-full flex-col">
        <p className="text-[15px] leading-relaxed text-ink">
          Are you sure you want to delete &ldquo;{course.name}&rdquo;?
        </p>
        <p className="pt-2 text-sm leading-relaxed text-ink-muted-48">
          This will permanently remove the course from your list. You cannot
          restore it from the Courses page.
        </p>

        {state.error ? (
          <p className="pt-4 text-center text-sm text-destructive" role="alert">
            {state.error}
          </p>
        ) : null}

        <form action={formAction} className={dialogActionsClassName}>
          <input type="hidden" name="id" value={course.id} />
          <Button
            type="submit"
            disabled={pending}
            className={`${dialogPrimaryActionClassName} bg-destructive text-white hover:bg-destructive/90`}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className={dialogSecondaryActionClassName}
          >
            Cancel
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

function CoursesEmptyState({ onAddCourse }: { onAddCourse: () => void }) {
  return (
    <div className="flex min-h-[min(28rem,calc(100svh-14rem))] flex-col items-center justify-center px-2 py-12 text-center sm:min-h-[min(32rem,calc(100svh-16rem))] sm:px-4 sm:py-16">
      <BookOpen
        className="mb-4 size-12 text-ink-muted-48 sm:size-16"
        aria-hidden="true"
        strokeWidth={1.5}
      />
      <h2 className="font-display text-xl font-semibold text-ink sm:text-[22px]">
        No Courses Yet
      </h2>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted-48">
        Create your first course to get started.
      </p>
      <Button
        type="button"
        onClick={onAddCourse}
        className="mt-6 min-h-11 w-full max-w-xs rounded-full px-5 sm:w-auto"
      >
        New Course
      </Button>
    </div>
  );
}

export function CourseList({ courses, onAddCourse }: CourseListProps) {
  const [editingCourse, setEditingCourse] = useState<CourseListItem | null>(
    null,
  );
  const [deletingCourse, setDeletingCourse] = useState<CourseListItem | null>(
    null,
  );

  if (courses.length === 0) {
    return (
      <CoursesEmptyState onAddCourse={onAddCourse ?? (() => undefined)} />
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {courses.map((course) => (
          <CourseRow
            key={course.id}
            course={course}
            onEdit={() => setEditingCourse(course)}
            onDelete={() => setDeletingCourse(course)}
          />
        ))}
      </ul>

      {editingCourse ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingCourse(null);
          }}
          title="Edit course"
        >
          <CourseForm
            course={editingCourse}
            submitLabel="Save changes"
            namePlaceholder="Edit course"
            onCancel={() => setEditingCourse(null)}
            onSuccess={() => setEditingCourse(null)}
          />
        </Dialog>
      ) : null}

      {deletingCourse ? (
        <DeleteCourseDialog
          course={deletingCourse}
          open
          onOpenChange={(open) => {
            if (!open) setDeletingCourse(null);
          }}
        />
      ) : null}
    </>
  );
}
