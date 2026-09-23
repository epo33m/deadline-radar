import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ICON_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_ICON_LENGTH = 64;

const optionalCode = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > 50) {
      ctx.addIssue({
        code: "custom",
        message: "Course code must be 50 characters or less",
      });
      return z.NEVER;
    }
    return trimmed;
  });

const optionalDescription = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > 5000) {
      ctx.addIssue({
        code: "custom",
        message: "Course description must be 5000 characters or less",
      });
      return z.NEVER;
    }
    return trimmed;
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

const patchCode = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > 50) {
      ctx.addIssue({
        code: "custom",
        message: "Course code must be 50 characters or less",
      });
      return z.NEVER;
    }
    return trimmed;
  });

const patchDescription = z
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
        message: "Course description must be 5000 characters or less",
      });
      return z.NEVER;
    }
    return trimmed;
  });

const patchHexColor = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (!HEX_COLOR.test(normalized)) {
      ctx.addIssue({
        code: "custom",
        message: "Color must be a hex value like #0066cc",
      });
      return z.NEVER;
    }
    return normalized.toLowerCase();
  });

const patchIconSlug = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
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
    name: z
      .string()
      .trim()
      .min(1, "Course name is required")
      .max(255, "Course name must be 255 characters or less"),
    code: optionalCode,
    color: optionalHexColor,
    icon: optionalIconSlug,
    description: optionalDescription,
  })
  .strict();

/** PATCH body: optional fields; preserves undefined for omitted fields. */
export const coursePatchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Course name is required")
      .max(255, "Course name must be 255 characters or less")
      .optional(),
    code: patchCode,
    color: patchHexColor,
    icon: patchIconSlug,
    description: patchDescription,
    updatedAt: z.string().datetime({ offset: true }).optional(),
    updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type CourseInput = z.infer<typeof courseSchema>;

