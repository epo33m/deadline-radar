/**
 * Shared form layout tokens.
 *
 * Plain module (no "use client") so it can be imported by both Server
 * Components and Client Components without crossing the client boundary.
 */

/** Shared field-group card chrome: surface, border, radius, inset padding. */
export const formCardClassName =
  "overflow-hidden rounded-xl border border-divider-soft bg-surface-pearl px-3 pt-0 pb-1";

/** Vertical gap between a title/header and the first section: 16px. */
export const formTitleGapClassName = "mt-4";

/** Vertical gap between major sections (card → card / card → actions): 12px. */
export const formSectionGapClassName = "space-y-3";

/** Vertical gap between stacked action buttons: 10px. */
export const formActionGapClassName = "gap-2.5";