"use client";

import { Info } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 12;
const TRIGGER_GAP = 8;
const ARROW_SIZE = 8;

type TooltipPosition = {
  top: number;
  left: number;
  placement: "top" | "bottom";
  arrowLeft: number;
};

/**
 * Compact info tooltip anchored to its icon: centered under the icon with a
 * small arrow, flipping above when the viewport runs out of room. Unlike the
 * menu primitive it never turns into a bottom sheet — it stays a bubble
 * beside the field on every screen size.
 */
export function FieldInfoButton({ info }: { info: string }) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isHoverDevice = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  const updatePosition = useCallback(() => {
    const trigger = buttonRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    const center = triggerRect.left + triggerRect.width / 2;

    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, center - width / 2),
      window.innerWidth - VIEWPORT_MARGIN - width,
    );

    const fitsBelow =
      triggerRect.bottom + TRIGGER_GAP + height <=
      window.innerHeight - VIEWPORT_MARGIN;

    setPosition({
      top: fitsBelow
        ? triggerRect.bottom + TRIGGER_GAP
        : Math.max(VIEWPORT_MARGIN, triggerRect.top - TRIGGER_GAP - height),
      left,
      placement: fitsBelow ? "bottom" : "top",
      arrowLeft: Math.min(
        Math.max(ARROW_SIZE + 4, center - left),
        width - ARROW_SIZE - 4,
      ),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current?.contains(target) ||
        tooltipRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`More information: ${info}`}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse" || !isHoverDevice()) return;
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = setTimeout(() => {
            setPosition(null);
            setOpen(true);
          }, 150);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse" || !isHoverDevice()) return;
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          setOpen(false);
        }}
        onClick={() => {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          setPosition(null);
          setOpen((current) => !current);
        }}
        onBlur={() => setOpen(false)}
        className="pointer-events-auto relative inline-flex size-7 items-center justify-center rounded-full text-ink-muted-48 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-2 after:content-['']"
      >
        <Info className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </button>

      {open
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              style={{
                top: position?.top ?? 0,
                left: position?.left ?? 0,
                visibility: position ? "visible" : "hidden",
              }}
              className="pointer-events-none fixed z-[80] w-max max-w-60 rounded-[10px] bg-ink px-3 py-2 text-[13px] font-medium leading-snug tracking-[-0.08px] text-canvas shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
            >
              {info}
              {position ? (
                <span
                  aria-hidden="true"
                  style={{
                    left: position.arrowLeft - ARROW_SIZE / 2,
                    ...(position.placement === "bottom"
                      ? { top: -ARROW_SIZE / 2 }
                      : { bottom: -ARROW_SIZE / 2 }),
                  }}
                  className="absolute size-2 rotate-45 rounded-[1px] bg-ink"
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
