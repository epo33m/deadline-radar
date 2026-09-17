import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ICON_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_ICON_LENGTH = 64;

const optionalTrimmedNullable = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

const optionalHexColor = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (!HEX_COLOR.test(trimmed)) {
      ctx.addIssue({
        code: "custom",
        message: "Color must be a hex value like #0066cc",
      });
      return z.NEVER;
    }
    return trimmed.toLowerCase();
  });

/**
 * Optional Lucide icon slug (kebab-case, e.g. 'book-open').
 * Format-only check: unknown-but-well-formed slugs pass and render
 * as None on the frontend, keeping validation decoupled from lucide-react.
 */
const optionalIconSlug = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length === 0) return null;
    if (trimmed.length > MAX_ICON_LENGTH || !ICON_SLUG.test(trimmed)) {
      ctx.addIssue({
        code: "custom",
        message: "Icon must be a kebab-case slug like book-open",
      });
      return z.NEVER;
    }
    return trimmed;
  });

export const courseSchema = z
  .object({
    name: z.string().trim().min(1, "Course name is required"),
    code: optionalTrimmedNullable,
    color: optionalHexColor,
    icon: optionalIconSlug,
    description: optionalTrimmedNullable,
  })
  .strict();

/** PATCH body: same fields; optional updatedAt for optimistic concurrency. */
export const coursePatchSchema = z
  .object({
    name: z.string().trim().min(1, "Course name is required"),
    code: optionalTrimmedNullable,
    color: optionalHexColor,
    icon: optionalIconSlug,
    description: optionalTrimmedNullable,
    updatedAt: z.string().datetime({ offset: true }).optional(),
    updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type CourseInput = z.infer<typeof courseSchema>;
