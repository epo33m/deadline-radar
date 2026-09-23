/**
 * Shared shell container tokens.
 *
 * Plain module (no "use client") so it can be imported by both Server
 * Components and Client Components without crossing the client boundary.
 */

/**
 * Horizontal container shared by the top navigation and page content so both
 * resolve to the same capped, padded content edge at every viewport.
 */
export const shellContainerClassName =
  "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";