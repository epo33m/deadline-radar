import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The landing hero's sticky-note board: a static pile of course notes rendered
 * as physical paper lying on the page.
 *
 * This is illustrative marketing imagery, not the visitor's coursework — every
 * course, task and timestamp below is sample content. Nothing is read from the
 * database and nothing is gated on a session, so the board stays a Server
 * Component with no client JS.
 *
 * The pile is deliberately inert: no hover response, no transitions, no
 * animation. Each note is a fixed tilt at a fixed depth, and the depth is read
 * from the shadow and the `z-*` alone — the composition has to survive with
 * motion off, with a pointer device absent, and in a static screenshot.
 *
 * There is no desk panel behind the notes: the paper lies straight on the page's
 * parchment. That is why the tone constraint below is a floor rather than a
 * range — with no panel to lift the pile off, a sheet only reads as paper if it
 * is clearly lighter than the canvas it sits on.
 *
 * The notes are the one place in the marketing surface where a drop shadow is
 * used: DESIGN.md reserves shadow for product imagery resting on a surface, and
 * this pile *is* the product imagery. The notes therefore get progressively
 * heavier shadows the closer they sit to the viewer, with `TODAY` — the focal
 * note — heaviest of all.
 */

/**
 * Paper tones, one per note. They are deliberately not design tokens: each note
 * is a distinct physical sheet, so each carries its own surface rather than
 * sharing a token with the rest of the product.
 *
 * Every tone is at least `#fafaf9`, which is the lightest step that still reads
 * as a separate sheet against `canvas-parchment` (#f5f5f7) — a note only two or
 * three points lighter than the page disappears into it, leaving only its border
 * and shadow to say "there is a note here". The variety left above that floor
 * is warm/cool drift, not a contrast ramp.
 */
const NOTE_SHADOW = {
  back: "shadow-[0_8px_20px_-8px_rgba(0,0,0,0.04)]",
  backSoft: "shadow-[0_6px_16px_-6px_rgba(0,0,0,0.03)]",
  mid: "shadow-[0_12px_28px_-10px_rgba(0,0,0,0.06)]",
  front:
    "shadow-[0_16px_36px_-10px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.02)]",
  lead: "shadow-[0_24px_50px_-10px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.04)]",
} as const;

/**
 * Each note is a fixed piece of paper: a tilt, a radius, a hairline edge and a
 * shadow. No transform transitions and no hover state — see the note above on
 * why the pile is inert.
 */
const paperClassName = "absolute rounded-[4px] border border-black/[0.06]";

function Note({
  shadow,
  className,
  children,
}: {
  shadow: keyof typeof NOTE_SHADOW;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(paperClassName, NOTE_SHADOW[shadow], className)}>
      {children}
    </div>
  );
}

/**
 * Squiggle paths standing in for handwriting. They are `currentColor` strokes,
 * so the surrounding group sets both the colour and its opacity rather than
 * each path hard-coding a grey.
 */
const RULE_WIDE =
  "M2 7C14 4.5 28 8.5 42 6C56 3.5 70 8 84 5.5C98 3 112 7.5 126 5C140 2.5 154 6.5 168 5C178 4 186 6 195 5";
const RULE_MID =
  "M2 6C12 4 24 8 36 5.5C48 3 60 7 72 5C84 3 96 6.5 108 5C118 3.5 130 5.5 142 5";
const RULE_TAIL = "M2 5C10 3.5 18 6.5 26 5C36 3.5 46 6.5 56 5C66 3.5 72 5 78 5";
const RULE_FOOT =
  "M2 5C14 3.5 28 6.5 42 5C56 3.5 70 6.5 84 5C98 3.5 112 6 126 5";

function Scribble({
  path,
  span = 200,
  weight = 1.3,
  className,
}: {
  path: string;
  span?: number;
  weight?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${span} 12`}
      className={cn("h-3 w-full", className)}
      fill="none"
      aria-hidden="true"
    >
      <path
        d={path}
        stroke="currentColor"
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Shared header for a course note: the course code on the left, a due stamp on
 * the right, split by a hairline. `micro-legal` is the smallest type in the
 * system, and `ink-muted-64` is used rather than `ink-muted-48` because these
 * stamps are body text, not the legal fine print that token is reserved for.
 */
function NoteHeader({
  label,
  stamp,
  labelClassName,
}: {
  label: string;
  stamp: string;
  labelClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-black/[0.04] pb-1.5">
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted-64",
          labelClassName,
        )}
      >
        {label}
      </span>
      <span className="text-[10.5px] tabular-nums text-ink-muted-64">
        {stamp}
      </span>
    </div>
  );
}

export function HeroNoteBoard() {
  return (
    <div className="mt-6 flex w-full min-w-0 max-w-5xl flex-1 items-center justify-center pt-2 pb-6 sm:mt-8 sm:pt-4 sm:pb-8">
      {/* `relative` is the notes' containing block — the tilts and the negative
          insets are all resolved against this box, not the page. `min()` caps
          keep the same composition on desktop but let wide notes shrink on
          320–360px viewports instead of overflowing. */}
      <div className="relative flex h-[510px] w-full min-w-0 items-center justify-center overflow-hidden sm:h-[490px] sm:overflow-visible">
        <Note
          shadow="back"
          className="-left-[4%] top-[6px] z-[5] w-[min(215px,62vw)] -rotate-[6.8deg] bg-[#faf8f5] p-4 sm:-left-[2%] sm:w-[250px]"
        >
          <NoteHeader label="Coursework" stamp="Thu 17:00" />
          <p className="text-[13.5px] font-semibold leading-snug tracking-[-0.12px] text-ink">
            BIO-204 · Biology
          </p>
          <div className="mt-3 space-y-2 text-ink/35">
            <Scribble path={RULE_WIDE} />
            <Scribble path={RULE_MID} className="w-[75%]" />
          </div>
        </Note>

        <Note
          shadow="backSoft"
          className="-top-[16px] left-[24%] z-[4] w-[min(200px,58vw)] rotate-[5.4deg] bg-[#fbfbfa] p-4 sm:left-[21%] sm:w-[240px]"
        >
          <NoteHeader label="HIST-110" stamp="Draft" />
          <p className="text-[13px] font-semibold leading-snug tracking-[-0.12px] text-ink">
            Post-war Architecture
          </p>
          <div className="mt-3 space-y-2 text-ink/30">
            <Scribble path={RULE_MID} />
            <Scribble path={RULE_MID} className="w-[60%]" />
          </div>
        </Note>

        <Note
          shadow="mid"
          className="bottom-[16px] -left-[5%] z-[9] w-[min(215px,62vw)] -rotate-[5.5deg] bg-[#fbfaf8] p-4 sm:bottom-[22px] sm:left-[0%] sm:w-[255px]"
        >
          <NoteHeader label="ARCH-310" stamp="Mon 09:00" />
          <p className="text-[13px] font-semibold leading-snug tracking-[-0.12px] text-ink">
            Spatial Ergonomics Model
          </p>
          <div className="mt-3 space-y-2 text-ink/35">
            <Scribble path={RULE_MID} />
            <Scribble path={RULE_MID} className="w-[65%]" />
          </div>
        </Note>

        <Note
          shadow="front"
          className="left-[2%] top-[54px] z-[12] w-[min(300px,84vw)] rotate-[3.8deg] bg-[#fafaf9] p-6 sm:left-[11%] sm:w-[365px]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-black/[0.04] pb-3">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted-64">
              This Week
            </span>
            <div className="w-16 text-ink/30">
              <Scribble path={RULE_TAIL} className="h-2.5" />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-ink">
                  History Essay
                </p>
                <span className="text-[10.5px] tabular-nums text-ink-muted-64">
                  Thu 17:00
                </span>
              </div>
              <div className="text-ink/35">
                <Scribble path={RULE_WIDE} weight={1.4} className="w-[88%]" />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-ink">
                  Design Project
                </p>
                <span className="text-[10.5px] tabular-nums text-ink-muted-64">
                  Fri 12:00
                </span>
              </div>
              <div className="text-ink/35">
                <Scribble path={RULE_MID} className="w-[75%]" />
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-black/[0.04] pt-3 text-ink/40">
            <Scribble path={RULE_MID} className="w-28" />
            <Scribble path={RULE_TAIL} className="w-20" />
          </div>
        </Note>

        <Note
          shadow="backSoft"
          className="-top-[10px] right-[30%] z-[6] w-[min(215px,62vw)] -rotate-[3.9deg] bg-[#fafaf9] p-4 sm:right-[33%] sm:w-[245px]"
        >
          <NoteHeader label="Thesis" stamp="Draft v2" />
          <p className="text-[13px] font-semibold leading-snug tracking-[-0.12px] text-ink">
            Research Proposal
          </p>
          <div className="mt-3 space-y-2 text-ink/30">
            <Scribble path={RULE_MID} />
            <Scribble path={RULE_MID} className="w-[80%]" />
          </div>
        </Note>

        <Note
          shadow="back"
          className="-top-[8px] -right-[3%] z-[7] w-[min(225px,64vw)] rotate-[6.2deg] bg-[#fbfaf6] p-4 sm:top-[2px] sm:right-[4%] sm:w-[265px]"
        >
          <NoteHeader label="CS-182" stamp="Fri 18:00" />
          <p className="text-[13px] font-semibold leading-snug tracking-[-0.12px] text-ink">
            Transformer Architecture
          </p>
          <div className="mt-3 space-y-2 text-ink/35">
            <Scribble path={RULE_WIDE} />
            <Scribble path={RULE_MID} className="w-[70%]" />
          </div>
        </Note>

        <Note
          shadow="back"
          className="right-[14%] top-[34px] z-[8] w-[min(230px,66vw)] -rotate-[4.2deg] bg-[#fafaf9] p-4 sm:right-[19%] sm:w-[260px]"
        >
          <NoteHeader label="Midterms" stamp="Week 8" />
          <p className="text-[13px] font-semibold leading-snug tracking-[-0.12px] text-ink">
            Cognitive Science
          </p>
          <div className="mt-3 space-y-2 text-ink/30">
            <Scribble path={RULE_MID} />
            <Scribble path={RULE_MID} className="w-[70%]" />
          </div>
        </Note>

        <Note
          shadow="mid"
          className="top-[165px] -right-[4%] z-[10] w-[min(210px,60vw)] rotate-[7.5deg] bg-[#fafaf9] p-4 sm:top-[175px] sm:right-[1%] sm:w-[250px]"
        >
          <NoteHeader label="ECON-201" stamp="Upcoming" />
          <p className="text-[13px] font-semibold leading-snug tracking-[-0.12px] text-ink">
            Problem Set 03
          </p>
          <div className="mt-3 space-y-2 text-ink/30">
            <Scribble path={RULE_MID} />
            <Scribble path={RULE_MID} className="w-[55%]" />
          </div>
        </Note>

        <Note
          shadow="front"
          className="right-[2%] top-[98px] z-[18] w-[min(310px,86vw)] rotate-[4.7deg] bg-[#fbfbfd] p-6 sm:right-[10%] sm:w-[375px]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-black/[0.04] pb-3">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted-64">
              Tomorrow
            </span>
            <span className="text-[11px] tabular-nums text-ink-muted-64">
              Due 23:59
            </span>
          </div>

          <div className="mt-1">
            <h3 className="text-[20px] font-semibold leading-snug tracking-[-0.28px] text-ink sm:text-[22px]">
              Physics
            </h3>
            <div className="mt-3.5 space-y-2.5 text-ink/40">
              <Scribble path={RULE_WIDE} weight={1.5} className="h-3.5" />
              <Scribble
                path={RULE_WIDE}
                weight={1.4}
                className="h-3.5 w-[82%]"
              />
              <Scribble path={RULE_MID} weight={1.3} />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-black/[0.04] pt-3.5">
            <Scribble path={RULE_FOOT} className="w-32" />
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink/30">
              Phys-Lab
            </span>
          </div>
        </Note>

        {/* The focal note. Sits off-centre and crooked, and carries the heaviest
            shadow in the pile. */}
        <Note
          shadow="lead"
          className="left-[4%] top-[82px] z-[30] w-[min(335px,88vw)] -rotate-[2.8deg] border-black/[0.07] bg-[#fdfcf9] p-7 sm:left-[13%] sm:w-[425px]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-black/[0.05] pb-3.5">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-destructive" />
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink">
                Today
              </span>
            </div>
            {/* The urgency is carried by the dot and the tint; the label itself
                stays ink so the badge clears WCAG AA at 11px, which a
                `text-destructive` label would not. */}
            <span className="inline-flex items-center rounded-[2px] bg-destructive/10 px-2.5 py-0.5 text-[11px] font-semibold tracking-[-0.12px] text-ink">
              Due today · 14:00
            </span>
          </div>

          <div className="mt-3">
            <h2 className="text-[clamp(1.375rem,1rem+5vw,1.875rem)] font-semibold leading-tight tracking-[-0.28px] text-ink">
              Mathematics
            </h2>
            <div className="mt-5 space-y-3 text-ink/45">
              <Scribble path={RULE_WIDE} weight={1.6} className="h-4" />
              <Scribble path={RULE_WIDE} weight={1.5} className="h-4 w-[88%]" />
              <Scribble path={RULE_MID} weight={1.4} className="h-3.5" />
            </div>
          </div>

          <div className="mt-7 flex items-center justify-between gap-3 border-t border-black/[0.05] pt-4">
            <div className="flex items-center gap-2 text-ink/40">
              <span className="size-1.5 rounded-full bg-destructive" />
              <Scribble path={RULE_TAIL} className="w-24" />
            </div>
            <div className="w-16 text-ink/35">
              <Scribble path={RULE_TAIL} />
            </div>
          </div>
        </Note>
      </div>
    </div>
  );
}
