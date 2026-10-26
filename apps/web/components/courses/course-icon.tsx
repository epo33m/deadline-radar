import { createElement } from "react";

import { getCourseIcon } from "@/lib/courses/icons";

type CourseIconViewProps = {
  slug: string | null | undefined;
  className?: string;
  size?: "sm" | "md" | "lg";
  strokeWidth?: number;
};

const SIZE_CLASSES: Record<string, string> = {
  sm: "size-3",
  md: "size-20",
  lg: "size-24",
};

/**
 * Static wrapper for rendering a stored Lucide slug.
 * The resolved component comes from lucide-react's static `icons` map, so
 * the reference is stable per slug and stateless SVG never loses state —
 * createElement keeps this indirection explicit.
 *
 * `size` offers a shorthand for the most common render sizes so callers
 * (icon picker, course card, course detail) share one component instead of
 * three separate ways of drawing an icon.
 */
export function CourseIconView({
  slug,
  className,
  size,
  strokeWidth = 1.75,
}: CourseIconViewProps) {
  const Icon = getCourseIcon(slug);
  if (!Icon) return null;
  return createElement(Icon, {
    className: cnSize(size, className),
    strokeWidth,
    "aria-hidden": true,
  });
}

function cnSize(size: string | undefined, className: string | undefined): string {
  const base = size ? SIZE_CLASSES[size] ?? "" : "";
  return [base, className].filter(Boolean).join(" ");
}
