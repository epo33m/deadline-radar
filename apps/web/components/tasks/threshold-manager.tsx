"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  addReminderThreshold,
  removeReminderThreshold,
  updateReminderThreshold,
  type TaskActionState,
} from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReminderThreshold } from "@/types/task";

const initialState: TaskActionState = {};

function thresholdLabel(daysBefore: number): string {
  return daysBefore === 0
    ? "At deadline"
    : `${daysBefore} day${daysBefore === 1 ? "" : "s"} before`;
}

function AddThresholdForm({ taskId }: { taskId: string }) {
  const [state, formAction, pending] = useActionState(
    addReminderThreshold,
    initialState,
  );
  const [daysBefore, setDaysBefore] = useState("");
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setDaysBefore("");
    }
    wasPending.current = pending;
  }, [pending, state.error]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="task_id" value={taskId} />
      <div className="space-y-2">
        <Label htmlFor={`add-days-before-${taskId}`}>Days before deadline</Label>
        <Input
          id={`add-days-before-${taskId}`}
          name="days_before"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={daysBefore}
          onChange={(event) => setDaysBefore(event.target.value)}
          placeholder="e.g. 14"
          required
          className="w-36"
          aria-invalid={Boolean(state.fieldErrors?.days_before)}
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add threshold"}
      </Button>
      {state.error ? (
        <p className="basis-full text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function ThresholdRow({
  taskId,
  threshold,
}: {
  taskId: string;
  threshold: ReminderThreshold;
}) {
  const [editState, editAction, editPending] = useActionState(
    updateReminderThreshold,
    initialState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeReminderThreshold,
    initialState,
  );
  const [daysBefore, setDaysBefore] = useState(String(threshold.days_before));
  const error = editState.error ?? removeState.error;
  const pending = editPending || removePending;

  return (
    <li className="border-b border-hairline py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <form action={editAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={threshold.id} />
          <input type="hidden" name="task_id" value={taskId} />
          <Label htmlFor={`days-before-${threshold.id}`}>
            H-
            <span className="sr-only">
              {threshold.days_before} days before
            </span>
          </Label>
          <Input
            id={`days-before-${threshold.id}`}
            name="days_before"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={daysBefore}
            onChange={(event) => setDaysBefore(event.target.value)}
            required
            className="w-20"
            aria-invalid={Boolean(editState.fieldErrors?.days_before)}
          />
          <span className="text-sm text-ink-muted-48">
            {threshold.is_default ? "Default" : "Custom"} ·{" "}
            {thresholdLabel(threshold.days_before)}
          </span>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {editPending ? "Saving…" : "Save"}
          </Button>
        </form>
        <form action={removeAction}>
          <input type="hidden" name="id" value={threshold.id} />
          <input type="hidden" name="task_id" value={taskId} />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={pending}
            className="text-destructive"
          >
            {removePending ? "Removing…" : "Remove"}
          </Button>
        </form>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

type ThresholdManagerProps = {
  taskId: string;
  thresholds: ReminderThreshold[];
};

export function ThresholdManager({
  taskId,
  thresholds,
}: ThresholdManagerProps) {
  const sortedThresholds = [...thresholds].sort(
    (a, b) => b.days_before - a.days_before,
  );

  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl font-semibold">Reminder thresholds</h2>
      <p className="text-sm text-ink-muted-48">
        Default H-7 / H-3 / H-1 / H-0 are created with the task. Add, edit, or
        remove thresholds per task. Days before must be unique on this task.
        Thresholds already past are kept but not fired retroactively by the
        scheduler.
      </p>
      {sortedThresholds.length === 0 ? (
        <p className="text-sm text-ink-muted-48">
          No thresholds yet. Add one below, or confirm the tasks migration is
          applied.
        </p>
      ) : (
        <ul className="border-t border-hairline">
          {sortedThresholds.map((threshold) => (
            <ThresholdRow
              key={threshold.id}
              taskId={taskId}
              threshold={threshold}
            />
          ))}
        </ul>
      )}
      <AddThresholdForm taskId={taskId} />
    </div>
  );
}
