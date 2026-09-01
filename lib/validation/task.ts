import { z } from "zod";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);

const optionalTrimmedNullable = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

const optionalDurationMinutes = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return null;
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 1) {
        ctx.addIssue({
          code: "custom",
          message: "Estimated duration must be a positive whole number of minutes",
        });
        return z.NEVER;
      }
      return value;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (!/^\d+$/.test(trimmed)) {
      ctx.addIssue({
        code: "custom",
        message: "Estimated duration must be a positive whole number of minutes",
      });
      return z.NEVER;
    }
    const minutes = Number(trimmed);
    if (!Number.isInteger(minutes) || minutes < 1) {
      ctx.addIssue({
        code: "custom",
        message: "Estimated duration must be a positive whole number of minutes",
      });
      return z.NEVER;
    }
    return minutes;
  });

const deadlineSchema = z
  .string()
  .trim()
  .min(1, "Deadline is required")
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Deadline must be a valid date and time",
  })
  .transform((value) => new Date(value).toISOString());

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required"),
  course_id: z.uuid("Course is required"),
  deadline: deadlineSchema,
  status: taskStatusSchema,
  description: optionalTrimmedNullable,
  estimated_duration: optionalDurationMinutes,
});

export type TaskInput = z.infer<typeof taskSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
