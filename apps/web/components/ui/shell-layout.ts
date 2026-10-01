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

/**
 * Surface shared by the public top navigation and the public footer, so the two
 * ends of the page are the same colour rather than two near-identical literals
 * that drift apart.
 *
 * `surface-pearl` (#fafafc) is the base, but the nav does not use it opaque:
 * where `backdrop-filter` is supported it drops to 80% and blurs, so it reads
 * as pearl composited over whatever passes underneath. The footer sits on the
 * same class string. On a page whose ground is `canvas-parchment` (#f5f5f7)
 * that composite resolves to about #f9f9fb — one point off #fafafc, which is
 * invisible side by side but enough that a bare `bg-surface-pearl` footer reads
 * as a slightly different band from the nav above it.
 */
export const chromeSurfaceClassName =
  "bg-surface-pearl supports-[backdrop-filter]:bg-surface-pearl/80 supports-[backdrop-filter]:backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150";