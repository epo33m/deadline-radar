"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { ChevronRight } from "lucide-react";

import {
  addReminderThreshold,
  removeReminderThreshold,
  updateReminderThreshold,
  type TaskActionState,
} from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DialogFormRow,
  dialogFormListClassName,
  formCardClassName,
} from "@/components/ui/dialog-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { thresholdTriggerAt } from "@/lib/reminders/evaluate";
import { cn } from "@/lib/utils";
import type { ReminderThreshold } from "@/types/task";

const initialState: TaskActionState = {};

const DEFAULT_OFFSETS = [7, 3, 1, 0] as const;

const PAST_TRIGGER_MESSAGE =
  "Pick a smaller number of days so the reminder is still ahead";

// V1: defaults only. Flip to true post-production to re-enable custom thresholds.
const SHOW_CUSTOM_THRESHOLDS = false;

function thresholdLabel(daysBefore: number): string {
  return daysBefore === 0
    ? "At deadline"
    : `${daysBefore} day${daysBefore === 1 ? "" : "s"} before`;
}

function thresholdShortLabel(daysBefore: number): string {
  return daysBefore === 0 ? "H-0" : `H-${daysBefore}`;
}

function defaultHint(onCount: number, pastEnabled: number): string {
  if (onCount === 0) {
    return "You won't receive any default reminders.";
  }
  if (pastEnabled === 0) {
    return onCount === DEFAULT_OFFSETS.length
      ? "You'll receive reminders at each default time."
      : "You'll receive reminders at the times you've selected.";
  }
  if (pastEnabled === onCount) {
    return "You won't receive reminders for times that have already passed.";
  }
  return "You'll receive reminders for the selected times that haven't passed.";
}

/** True when a non-default threshold's trigger instant is already in the past. */
function isPastTrigger(
  deadline: string,
  timeZone: string,
  daysBefore: number,
  now: Date = new Date(),
): boolean {
  if ((DEFAULT_OFFSETS as readonly number[]).includes(daysBefore)) return false;
  const trigger = thresholdTriggerAt(deadline, daysBefore, timeZone);
  if (Number.isNaN(trigger.getTime())) return false;
  return now.getTime() >= trigger.getTime();
}

function DefaultThresholdSwitch({
  present,
  pending,
  label,
}: {
  present: boolean;
  pending: boolean;
  label: string;
}) {
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={present}
      aria-label={label}
      disabled={pending}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        present ? "bg-primary" : "bg-hairline",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.5 left-0.5 size-6 rounded-full bg-canvas shadow-sm transition-transform",
          present && "translate-x-5",
        )}
      />
    </button>
  );
}

function DefaultThresholdRow({
  taskId,
  offset,
  threshold,
}: {
  taskId: string;
  offset: number;
  threshold: ReminderThreshold | undefined;
}) {
  const [addState, addAction, addPending] = useActionState(
    addReminderThreshold,
    initialState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeReminderThreshold,
    initialState,
  );
  const present = Boolean(threshold);
  const pending = addPending || removePending;
  const error = addState.error ?? removeState.error;
  const label = `${thresholdShortLabel(offset)} ${thresholdLabel(offset)}`;

  return (
    <DialogFormRow label={thresholdLabel(offset)}>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center justify-end gap-2">
          {present && threshold ? (
            <form action={removeAction} className="flex shrink-0">
              <input type="hidden" name="id" value={threshold.id} />
              <input type="hidden" name="task_id" value={taskId} />
              <DefaultThresholdSwitch
                present={present}
                pending={pending}
                label={label}
              />
            </form>
          ) : (
            <form action={addAction} className="flex shrink-0">
              <input type="hidden" name="task_id" value={taskId} />
              <input type="hidden" name="days_before" value={String(offset)} />
              <DefaultThresholdSwitch
                present={present}
                pending={pending}
                label={label}
              />
            </form>
          )}
        </div>
        {error ? (
          <p className="text-[13px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {pending ? <span className="sr-only">Saving…</span> : null}
      </div>
    </DialogFormRow>
  );
}

function DefaultRemindersSection({
  taskId,
  deadline,
  timeZone,
  defaultsByOffset,
}: {
  taskId: string;
  deadline: string;
  timeZone: string;
  defaultsByOffset: Map<number, ReminderThreshold>;
}) {
  const [open, setOpen] = useState(false);
  // Snapshot taken in the click handler (event phase may be impure);
  // the hint stays stable while the dialog is open.
  const [now, setNow] = useState(0);
  const onCount = DEFAULT_OFFSETS.filter((offset) =>
    defaultsByOffset.has(offset),
  ).length;
  const pastEnabled =
    now === 0
      ? 0
      : DEFAULT_OFFSETS.filter(
          (offset) =>
            defaultsByOffset.has(offset) &&
            thresholdTriggerAt(deadline, offset, timeZone).getTime() <= now,
        ).length;
  const hint = defaultHint(onCount, pastEnabled);
  const summary =
    onCount === DEFAULT_OFFSETS.length
      ? "On"
      : onCount === 0
        ? "Off"
        : `${onCount} of 4 enabled`;

  return (
    <>
      <ul className={cn("list-none", formCardClassName)}>
        <li>
          <button
            type="button"
            onClick={() => {
              setNow(Date.now());
              setOpen(true);
            }}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:py-3.5"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="shrink-0 text-[17px] font-medium leading-snug tracking-[-0.2px] text-ink">
                System default
              </span>
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[15px] text-ink-muted-80 sm:text-[17px]">
              <span className="truncate">{summary}</span>
              <ChevronRight
                className="size-4 shrink-0 text-ink-muted-48"
                aria-hidden="true"
                strokeWidth={1.75}
              />
            </span>
          </button>
        </li>
      </ul>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Default reminders"
      >
        <div className="w-full text-left">
          <ul
            aria-label="Default reminder thresholds"
            className={dialogFormListClassName}
          >
            {DEFAULT_OFFSETS.map((offset) => (
              <DefaultThresholdRow
                key={offset}
                taskId={taskId}
                offset={offset}
                threshold={defaultsByOffset.get(offset)}
              />
            ))}
          </ul>
          <p
            aria-live="polite"
            className="px-1 pt-1 text-[13px] leading-relaxed text-ink-muted-48"
          >
            {hint}
          </p>
        </div>
      </Dialog>
    </>
  );
}

function AddThresholdForm({
  taskId,
  deadline,
  timeZone,
}: {
  taskId: string;
  deadline: string;
  timeZone: string;
}) {
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

  const days = Number(daysBefore);
  const inPast =
    Number.isInteger(days) && days >= 0
      ? isPastTrigger(deadline, timeZone, days)
      : false;
  const invalid = inPast || Boolean(state.fieldErrors?.days_before);

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
          required
          className="w-36"
          aria-invalid={invalid}
          aria-describedby={
            invalid ? `add-days-before-${taskId}-error` : undefined
          }
        />
        {inPast ? (
          <p
            id={`add-days-before-${taskId}-error`}
            className="max-w-56 text-sm text-destructive"
            role="alert"
          >
            {state.fieldErrors?.days_before ?? PAST_TRIGGER_MESSAGE}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="sm" disabled={pending || inPast}>
        {pending ? "Adding…" : "Add threshold"}
      </Button>
      {state.error && !state.fieldErrors?.days_before ? (
        <p className="basis-full text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function ThresholdRow({
  taskId,
  deadline,
  timeZone,
  threshold,
}: {
  taskId: string;
  deadline: string;
  timeZone: string;
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

  const days = Number(daysBefore);
  const inPast =
    Number.isInteger(days) && days >= 0
      ? isPastTrigger(deadline, timeZone, days)
      : false;
  const invalid = inPast || Boolean(editState.fieldErrors?.days_before);

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
            aria-invalid={invalid}
            aria-describedby={
              invalid ? `days-before-${threshold.id}-error` : undefined
            }
          />
          <span className="text-sm text-ink-muted-48">
            {threshold.is_default ? "Default" : "Custom"} ·{" "}
            {thresholdLabel(threshold.days_before)}
          </span>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={pending || inPast}
          >
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
      {inPast ? (
        <p
          id={`days-before-${threshold.id}-error`}
          className="mt-2 text-sm text-destructive"
          role="alert"
        >
          {editState.fieldErrors?.days_before ?? PAST_TRIGGER_MESSAGE}
        </p>
      ) : null}
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
  deadline: string;
  timeZone: string;
  thresholds: ReminderThreshold[];
};

export function ThresholdManager({
  taskId,
  deadline,
  timeZone,
  thresholds,
}: ThresholdManagerProps) {
  const defaultsByOffset = new Map(
    thresholds
      .filter((t) => (DEFAULT_OFFSETS as readonly number[]).includes(t.days_before))
      .map((t) => [t.days_before, t]),
  );
  const customThresholds = thresholds
    .filter((t) => !(DEFAULT_OFFSETS as readonly number[]).includes(t.days_before))
    .sort((a, b) => b.days_before - a.days_before);

  return (
    <div>
      <h2 className="font-display text-[32px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[36px] lg:text-[44px]">
        Reminders
      </h2>
      <p className="mt-2 text-[15px] leading-[1.47] tracking-[-0.374px] text-ink-muted-64 sm:text-[17px]">
        Choose which reminder schedules to use.
      </p>
      <div className="mt-6 space-y-4 sm:mt-8">
        <DefaultRemindersSection
          taskId={taskId}
          deadline={deadline}
          timeZone={timeZone}
          defaultsByOffset={defaultsByOffset}
        />
      {thresholds.length === 0 ? (
        <p className="text-sm text-ink-muted-48">
          No thresholds yet. Turn on the default reminders above, or confirm the
          tasks migration is applied.
        </p>
      ) : null}
      {SHOW_CUSTOM_THRESHOLDS && customThresholds.length > 0 ? (
        <ul className="border-t border-hairline">
          {customThresholds.map((threshold) => (
            <ThresholdRow
              key={threshold.id}
              taskId={taskId}
              deadline={deadline}
              timeZone={timeZone}
              threshold={threshold}
            />
          ))}
        </ul>
      ) : null}
      {SHOW_CUSTOM_THRESHOLDS ? (
        <AddThresholdForm
          taskId={taskId}
          deadline={deadline}
          timeZone={timeZone}
        />
      ) : null}
      </div>
    </div>
  );
}
