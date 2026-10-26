# ADR-0002: Markdown rendering boundaries for description fields

- Status: Accepted
- Date: 2026-10-23

## Context

Task and course descriptions support a small Markdown subset (headings, lists,
GFM tables, task lists, emphasis, links, inline code, fenced code). Two
implementations exist: the styled renderer (`react-markdown` in
`apps/web/components/markdown/markdown.tsx`) and the plain-text stripper
(`stripMarkdown` in `packages/domain/src/plain-text.ts`). Both must agree, and
both must keep Markdown out of email reminders and in-app notifications, which
carry the task title only.

## Decision

- Render through `react-markdown` + `remark-gfm` into React elements only.
  No `rehype-raw`, so raw HTML is never rendered.
- `allowedElements` is a closed list (plus `span` for syntax highlighting).
- URLs pass a scheme allow-list: `http(s)`, `mailto`, in-app `/` and `#`.
  Protocol-relative (`//evil.com`), `data:` (except `data:image/*`), `vbscript`,
  and URLs with control characters are rejected.
- Images: same-origin, `blob:`, and `data:image/*` render; external images
  render as alt text only, matching the CSP `img-src 'self' blob: data:`. Failed
  images fall back to their alt text.
- Author headings are demoted (h1/h2→h4, h3→h5, h4–h6→h6) and each gets a
  per-instance id (prefixed with a `useId`) so in-description `#anchor` links
  resolve within that rendered copy.
- GFM task lists render as disabled checkboxes with an accessible state label.
- Fenced code blocks are highlighted with `rehype-highlight` (common language
  set) and are keyboard-scrollable (`tabIndex={0}`).
- Body text is normal weight; headings are semibold. The paragraph weight was
  changed from semibold to normal so headings read as headings.
- Email reminders and in-app notifications carry the task title only, never
  the description.
- `stripMarkdown` is the plain-text authority for one-line previews and mirrors
  the renderer's subset, including dropping raw HTML.

## Consequences

- One shared fixture (`packages/domain/src/test-fixtures/markdown-corpus.ts`)
  guards both implementations against drift.
- Adding a new multiline field must follow the checklist in
  `docs/ARCHITECTURE.md`.