/**
 * Course icon helpers — Lucide slugs end to end.
 *
 * The database stores a kebab-case Lucide slug (e.g. 'book-open') or NULL
 * for None. Rendering maps the slug to its PascalCase component via the
 * `icons` export of lucide-react, so no manual slug→component table is
 * needed and the picker automatically follows Lucide upgrades.
 *
 * Slug canonicalization:
 *   Lucide exports numeric slugs without separators between digit groups
 *   (e.g. 'arrow-down01', 'grid2x2'), while some consumers expect the
 *   canonical form with separators ('arrow-down-0-1', 'grid-2-2').
 *   `SLUG_CANONICAL_MAP` maps stored ⇢ canonical for those exceptions only
 *   (not a global rule — grid-2-2 does not follow a 0-1 pattern). Both forms
 *   resolve to the same Lucide component, so storage stays tolerant while
 *   `toCanonicalSlug()` gives consumers the canonical form.
 */

import { icons, type LucideIcon } from "lucide-react";

const ICON_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Stored slug ⇢ canonical Lucide slug, for numeric exceptions only. */
export const SLUG_CANONICAL_MAP: Readonly<Record<string, string>> = {
  "arrow-down01": "arrow-down-0-1",
  "arrow-down10": "arrow-down-1-0",
  "arrow-up01": "arrow-up-0-1",
  "arrow-up10": "arrow-up-1-0",
  "grid2x2": "grid-2-2",
} as const;

/** Reverse map: canonical ⇢ stored alias(es). */
const SLUG_ALIASES: Readonly<Record<string, string[]>> = (() => {
  const aliases: Record<string, string[]> = {};
  for (const [stored, canonical] of Object.entries(SLUG_CANONICAL_MAP)) {
    (aliases[canonical] ??= []).push(stored);
  }
  return aliases;
})();

export type CourseIconSuggestion = {
  slug: string;
  label: string;
  /**
   * Broad category for quick-filter chips (e.g. Education, Science, Tech).
   */
  category?: string;
  /**
   * Extra search terms for the picker. Labels are matched too, so this is for
   * synonyms that the Lucide slug does not contain (e.g. "Lab" → flask-conical).
   */
  keywords?: readonly string[];
};

/** Distinct categories across all suggestions, sorted — backs the quick-filter chips. */
export function getCourseIconCategories(): string[] {
  const categories = new Set<string>();
  for (const suggestion of SUGGESTED_COURSE_ICONS) {
    if (suggestion.category) categories.add(suggestion.category);
  }
  return [...categories].sort();
}

/** Default suggestions shown before searching the full Lucide set. */
export const SUGGESTED_COURSE_ICONS: readonly CourseIconSuggestion[] = [
  { slug: "book-open", label: "Book", category: "Education", keywords: ["Reading", "Study"] },
  {
    slug: "graduation-cap",
    label: "Graduation",
    category: "Education",
    keywords: ["Degree", "School", "University"],
  },
  { slug: "library", label: "Library", category: "Education", keywords: ["Books", "Shelf"] },
  {
    slug: "flask-conical",
    label: "Lab",
    category: "Science",
    keywords: ["Laboratory", "Science", "Chemistry"],
  },
  { slug: "calculator", label: "Math", category: "Science", keywords: ["Mathematics", "Calculate"] },
  { slug: "globe", label: "Globe", category: "Tech", keywords: ["World", "Earth", "Geography"] },
  {
    slug: "code-xml",
    label: "Code",
    category: "Tech",
    keywords: ["Programming", "Developer", "Software"],
  },
  { slug: "cpu", label: "Chip", category: "Tech", keywords: ["Processor", "Hardware", "Computer"] },
  { slug: "atom", label: "Atom", category: "Science", keywords: ["Physics", "Science"] },
  { slug: "palette", label: "Art", category: "Art", keywords: ["Design", "Paint", "Color"] },
  { slug: "music", label: "Music", category: "Art", keywords: ["Audio", "Song", "Sound"] },
  { slug: "dumbbell", label: "Sport", category: "Sport", keywords: ["Gym", "Fitness", "Workout"] },
  { slug: "briefcase", label: "Work", category: "Work", keywords: ["Business", "Job", "Office"] },
  {
    slug: "heart-pulse",
    label: "Health",
    category: "Health",
    keywords: ["Medical", "Medicine", "Heartbeat"],
  },
  { slug: "languages", label: "Language", category: "Education", keywords: ["Translate", "Speech"] },
  { slug: "pen-line", label: "Writing", category: "Art", keywords: ["Write", "Edit", "Note"] },
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

/** Canonical slug for a stored slug (numeric exceptions only); identity otherwise. */
export function toCanonicalSlug(slug: string): string {
  return SLUG_CANONICAL_MAP[slug] ?? slug;
}

/** Resolve a slug (canonical or stored alias) to the canonical stored form. */
export function resolveCourseIconSlug(slug: string): string {
  const canonical = toCanonicalSlug(slug);
  const alias = Object.entries(SLUG_CANONICAL_MAP).find(
    ([, c]) => c === canonical,
  );
  return alias ? alias[0] : canonical;
}

export function isValidCourseIconSlug(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const slug = value.trim().toLowerCase();
  return slug.length > 0 && slug.length <= 64 && ICON_SLUG_PATTERN.test(slug);
}

/** Slugs already warned about in development (warn once per slug). */
const warnedUnknownIcons = new Set<string>();

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
  if (component) return component;
  // Fall back to the canonical form (e.g. 'arrow-down-0-1' → 'ArrowDown01').
  const canonicalComponent = (icons as Record<string, LucideIcon | undefined>)[
    slugToPascalCase(toCanonicalSlug(slug))
  ];
  if (canonicalComponent) return canonicalComponent;

  // Dev-only: surface well-formed but unknown slugs instead of silently
  // rendering None. Validation stays format-only (decoupled from lucide-react);
  // this is a developer signal, not a runtime block.
  if (
    process.env.NODE_ENV === "development" &&
    !warnedUnknownIcons.has(slug)
  ) {
    warnedUnknownIcons.add(slug);
    // eslint-disable-next-line no-console
    console.warn(
      `[deadline-radar] Unknown course icon slug "${slug}": valid format, but not found in lucide-react. UI will render None.`,
    );
  }
  return null;
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
 * Normalize a picker value for storage: canonical slug or "" for None/invalid.
 * Unknown-but-well-formed slugs are kept — the API only checks format and the
 * UI falls back to None when Lucide lacks the icon.
 */
export function normalizeCourseIconForStorage(
  value: string | null | undefined,
): string {
  if (!value) return "";
  const slug = value.trim().toLowerCase();
  if (!isValidCourseIconSlug(slug)) return "";
  return toCanonicalSlug(slug);
}

/** All Lucide slugs (kebab-case), sorted — backing the picker search. */
let cachedAllSlugs: string[] | null = null;

export function getAllCourseIconSlugs(): string[] {
  if (!cachedAllSlugs) {
    cachedAllSlugs = Object.keys(icons).map(pascalToSlug).sort();
  }
  return cachedAllSlugs;
}
