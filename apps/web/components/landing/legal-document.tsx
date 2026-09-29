import type { ReactNode } from "react";

import { shellContainerClassName } from "@/components/ui/shell-layout";
import { LEGAL_EFFECTIVE_DATE } from "@/lib/legal";
import { cn } from "@/lib/utils";

/**
 * Shared prose layout for `/privacy` and `/terms`.
 *
 * The two pages differ only in their copy, so the chrome — page heading,
 * effective date, section rhythm, table of contents — lives here. Type follows
 * `{typography.body}` (17px / 400 / 1.47) with `{typography.tagline}` section
 * headings (21px / 600), the smallest display token that still reads as a
 * heading.
 *
 * Sections are a list rather than free-form JSX so each one gets an anchor and
 * a table-of-contents entry without either page hand-rolling them.
 */
export type LegalSection = {
  /** Slug used for the heading anchor and the table-of-contents entry. */
  id: string;
  heading: string;
  body: ReactNode;
};

/**
 * `dense-link` hit-area treatment, matching the footer: the 2.41 leading
 * renders each entry ~41px tall and the overlay adds the last 2px per side to
 * clear the 44px minimum. The 1px that spills past each edge lands in the
 * neighbouring row's leading, never on its glyphs.
 */
const tocEntryClassName =
  "relative block rounded-sm text-[17px] leading-[2.41] font-normal text-ink-muted-80 transition-colors before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-[''] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-parchment";

function LegalTableOfContents({
  sections,
}: {
  sections: readonly LegalSection[];
}) {
  return (
    <nav
      aria-labelledby="legal-toc-heading"
      className="border-t border-hairline pt-6"
    >
      <h2
        id="legal-toc-heading"
        className="text-sm leading-[1.29] font-semibold tracking-[-0.224px] text-ink-muted-80"
      >
        On this page
      </h2>
      <ol className="mt-3 flex flex-col">
        {sections.map((section, index) => (
          <li key={section.id}>
            <a href={`#${section.id}`} className={tocEntryClassName}>
              <span className="mr-2 tabular-nums text-ink-muted-48">
                {index + 1}.
              </span>
              {section.heading}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LegalDocument({
  title,
  summary,
  sections,
}: {
  title: string;
  summary: ReactNode;
  sections: readonly LegalSection[];
}) {
  return (
    <div className={cn(shellContainerClassName, "py-5 sm:py-6 lg:py-8")}>
      <div className="max-w-prose">
        <h1 className="font-display text-[36px] leading-[1.07] font-semibold tracking-[-0.28px] text-ink sm:text-[44px]">
          {title}
        </h1>
        <p className="mt-3 text-xs leading-none font-normal tracking-[-0.12px] text-ink-muted-48">
          Effective {LEGAL_EFFECTIVE_DATE}
        </p>

        <div className="mt-8 text-[17px] leading-[1.47] font-normal tracking-[-0.374px] text-ink-muted-80">
          {summary}
        </div>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-16">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <LegalTableOfContents sections={sections} />
        </div>

        <div className="max-w-prose">
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="scroll-mt-8 not-last:mb-12"
            >
              <h2 className="text-[21px] leading-[1.19] font-semibold tracking-[0.231px] text-ink">
                {section.heading}
              </h2>
              <div className="mt-3 space-y-4 text-[17px] leading-[1.47] font-normal tracking-[-0.374px] text-ink-muted-80">
                {section.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Bulleted list inside a `LegalSection`. The disc marker is tinted with
 * `{colors.primary}` — `{DESIGN.md}` allows exactly one accent, and it belongs
 * on interactive and enumerated elements alike.
 */
export function LegalList({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 ps-5 marker:text-primary">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** A `LegalSection` whose body is a run of paragraphs. */
export function LegalParagraphs({
  paragraphs,
}: {
  paragraphs: readonly string[];
}) {
  return (
    <>
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </>
  );
}
