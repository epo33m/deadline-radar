import { createElement } from "react";

import { getCourseIcon } from "@/lib/courses/icons";

type CourseIconViewProps = {
  slug: string | null | undefined;
  className?: string;
  strokeWidth?: number;
};

/**
 * Static wrapper for rendering a stored Lucide slug.
 * The resolved component comes from lucide-react's static `icons` map, so
 * the reference is stable per slug and stateless SVG never loses state —
 * createElement keeps this indirection explicit.
 */
export function CourseIconView({
  slug,
  className,
  strokeWidth = 1.75,
}: CourseIconViewProps) {
  const Icon = getCourseIcon(slug);
  if (!Icon) return null;
  return createElement(Icon, {
    className,
    strokeWidth,
    "aria-hidden": true,
  });
}
