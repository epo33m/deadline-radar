/**
 * Course icon helpers — Lucide slugs end to end.
 *
 * The database stores a kebab-case Lucide slug (e.g. 'book-open') or NULL
 * for None. Rendering maps the slug to its PascalCase component via the
 * `icons` export of lucide-react, so no manual slug→component table is
 * needed and the picker automatically follows Lucide upgrades.
 */

import { icons, type LucideIcon } from "lucide-react";

const ICON_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type CourseIconSuggestion = {
  slug: string;
  label: string;
};

/** Default suggestions shown before searching the full Lucide set. */
export const SUGGESTED_COURSE_ICONS: readonly CourseIconSuggestion[] = [
  { slug: "book-open", label: "Book" },
  { slug: "graduation-cap", label: "Graduation" },
  { slug: "library", label: "Library" },
  { slug: "flask-conical", label: "Lab" },
  { slug: "calculator", label: "Math" },
  { slug: "globe", label: "Globe" },
  { slug: "code-xml", label: "Code" },
  { slug: "cpu", label: "Chip" },
  { slug: "atom", label: "Atom" },
  { slug: "palette", label: "Art" },
  { slug: "music", label: "Music" },
  { slug: "dumbbell", label: "Sport" },
  { slug: "briefcase", label: "Work" },
  { slug: "heart-pulse", label: "Health" },
  { slug: "languages", label: "Language" },
  { slug: "pen-line", label: "Writing" },
];

export const NO_COURSE_ICON = {
  slug: "",
  label: "None",
} as const;

/** 'book-open' → 'BookOpen'. */
export function slugToPascalCase(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** 'BookOpen' → 'book-open'. */
export function pascalToSlug(name: string): string {
  return name
    .replace(/([A-Z])/g, "-$1")
    .replace(/^-/, "")
    .toLowerCase();
}

export function isValidCourseIconSlug(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const slug = value.trim().toLowerCase();
  return slug.length > 0 && slug.length <= 64 && ICON_SLUG_PATTERN.test(slug);
}

/** Resolve a stored slug to its Lucide component, or null for None/unknown. */
export function getCourseIcon(
  value: string | null | undefined,
): LucideIcon | null {
  if (!value) return null;
  const slug = value.trim().toLowerCase();
  if (!isValidCourseIconSlug(slug)) return null;
  const component = (icons as Record<string, LucideIcon | undefined>)[
    slugToPascalCase(slug)
  ];
  return component ?? null;
}

/** Human label: suggestion label when known, otherwise Title Case slug. */
export function getCourseIconLabel(value: string | null | undefined): string {
  if (!value) return NO_COURSE_ICON.label;
  const slug = value.trim().toLowerCase();
  if (!slug) return NO_COURSE_ICON.label;
  const suggestion = SUGGESTED_COURSE_ICONS.find((item) => item.slug === slug);
  if (suggestion) return suggestion.label;
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Normalize a picker value for storage: well-formed slug (lowercased) or ""
 * for None/invalid. Unknown-but-well-formed slugs are kept — the API only
 * checks format and the UI falls back to None when Lucide lacks the icon.
 */
export function normalizeCourseIconForStorage(
  value: string | null | undefined,
): string {
  if (!value) return "";
  const slug = value.trim().toLowerCase();
  if (!isValidCourseIconSlug(slug)) return "";
  return slug;
}

/** All Lucide slugs (kebab-case), sorted — backing the picker search. */
let cachedAllSlugs: string[] | null = null;

export function getAllCourseIconSlugs(): string[] {
  if (!cachedAllSlugs) {
    cachedAllSlugs = Object.keys(icons).map(pascalToSlug).sort();
  }
  return cachedAllSlugs;
}
