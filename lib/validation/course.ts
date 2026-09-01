import { z } from "zod";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const optionalTrimmedNullable = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

const optionalHexColor = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined) return null;
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

export const courseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Course name is required"),
  code: optionalTrimmedNullable,
  color: optionalHexColor,
});

export type CourseInput = z.infer<typeof courseSchema>;

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}
