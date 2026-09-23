import { z } from "zod";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

/**
 * Tasks are born active: completion is terminal and happens only through
 * the Mark-as-done path (`POST /:id/complete` or `PATCH` `todo/in_progress
 * → done`). Creating directly as `done` is rejected (DOMAIN.md §2.3).
 */
export const taskCreateStatusSchema = z.enum(["todo", "in_progress"]);

const optionalTrimmedNullable = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    if (value == null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > 5000) {
      ctx.addIssue({
        code: "custom",
        message: "Task description must be 5000 characters or less",
      });
      return z.NEVER;
    }
    return trimmed;
  });

const deadlineSchema = z
  .string()
  .trim()
  .min(1, "Deadline is required")
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Deadline must be a valid date and time",
  })
  .transform((value) => new Date(value).toISOString());

const patchTrimmedNullable = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > 5000) {
      ctx.addIssue({
        code: "custom",
        message: "Task description must be 5000 characters or less",
      });
      return z.NEVER;
    }
    return trimmed;
  });

export const taskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Task title is required")
      .max(255, "Task title must be 255 characters or less"),
    course_id: z.uuid("Course is required"),
    deadline: deadlineSchema,
    status: taskCreateStatusSchema,
    description: optionalTrimmedNullable,
  })
  .strict();

export const taskPatchSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Task title is required")
      .max(255, "Task title must be 255 characters or less")
      .optional(),
    course_id: z.uuid("Course is required").optional(),
    deadline: deadlineSchema.optional(),
    status: taskStatusSchema.optional(),
    description: patchTrimmedNullable,
    updatedAt: z.string().datetime({ offset: true }).optional(),
    updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

/**
 * days_before for a reminder threshold: integer ≥ 0 (DOMAIN.md §2.4),
 * capped so crafted values cannot overflow the Postgres integer column
 * (500 on insert) or produce invalid reminder dates downstream.
 */
export const MAX_DAYS_BEFORE = 36500;

export const reminderThresholdSchema = z
  .object({
    days_before: z
      .union([z.string(), z.number()])
      .transform((value, ctx) => {
        let days: number;
        if (typeof value === "number") {
          if (!Number.isInteger(value) || value < 0) {
            ctx.addIssue({
              code: "custom",
              message: "Days before must be a whole number of 0 or more",
            });
            return z.NEVER;
          }
          days = value;
        } else {
          const trimmed = value.trim();
          if (trimmed.length === 0) {
            ctx.addIssue({
              code: "custom",
              message: "Days before is required",
            });
            return z.NEVER;
          }
          if (!/^\d+$/.test(trimmed)) {
            ctx.addIssue({
              code: "custom",
              message: "Days before must be a whole number of 0 or more",
            });
            return z.NEVER;
          }
          days = Number(trimmed);
        }
        if (days > MAX_DAYS_BEFORE) {
          ctx.addIssue({
            code: "custom",
            message: `Days before must be ${MAX_DAYS_BEFORE} or less`,
          });
          return z.NEVER;
        }
        return days;
      }),
  })
  .strict();

export const reminderThresholdsPutSchema = z
  .object({
    thresholds: z
      .array(reminderThresholdSchema)
      .refine(
        (items) => {
          const seen = new Set<number>();
          for (const item of items) {
            if (seen.has(item.days_before)) return false;
            seen.add(item.days_before);
          }
          return true;
        },
        {
          message: "Duplicate days_before values are not allowed",
        },
      ),
  })
  .strict();

export type TaskInput = z.infer<typeof taskSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type ReminderThresholdInput = z.infer<typeof reminderThresholdSchema>;
export type ReminderThresholdsPutInput = z.infer<typeof reminderThresholdsPutSchema>;

