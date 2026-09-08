"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { getFocusableElements } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type PortalMenuPosition = {
  variant: "dropdown" | "sheet";
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

export type MeasureMenuOptions = {
  minWidth?: number;
  maxHeight?: number;
  minSpace?: number;
  belowThreshold?: number;
  /** Keep the dropdown anchored to the trigger on small viewports instead of switching to a bottom sheet. */
  disableSheet?: boolean;
  /** Span the viewport width minus gutters instead of sizing to the trigger. */
  fullWidth?: boolean;
  /**
   * Anchor the menu to the trigger's edge: "start" aligns the menu's left
   * edge to the trigger's left edge (default), "end" aligns the menu's
   * right edge to the trigger's right edge. Either way the menu stays
   * within the viewport margins.
   */
  align?: "start" | "end";
};

export const PORTAL_MENU_MARGIN = 16;
export const PORTAL_MENU_SHEET_BREAKPOINT = 640;

export function measureMenuPosition(
  trigger: HTMLElement,
  options: MeasureMenuOptions = {},
): PortalMenuPosition {
  const minWidth = options.minWidth ?? 300;
  const maxHeight = options.maxHeight ?? 380;
  const minSpace = options.minSpace ?? 160;
  const belowThreshold = options.belowThreshold ?? 200;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (!options.disableSheet && viewportWidth < PORTAL_MENU_SHEET_BREAKPOINT) {
    return {
      variant: "sheet",
      bottom: PORTAL_MENU_MARGIN,
      left: PORTAL_MENU_MARGIN,
      width: viewportWidth - PORTAL_MENU_MARGIN * 2,
      maxHeight: Math.min(maxHeight, viewportHeight - PORTAL_MENU_MARGIN * 2),
    };
  }

  const rect = trigger.getBoundingClientRect();
  const width = options.fullWidth
    ? viewportWidth - PORTAL_MENU_MARGIN * 2
    : Math.min(
        Math.max(rect.width, minWidth),
        viewportWidth - PORTAL_MENU_MARGIN * 2,
      );
  const left = Math.min(
    Math.max(
      PORTAL_MENU_MARGIN,
      options.align === "end" ? rect.right - width : rect.left,
    ),
    viewportWidth - width - PORTAL_MENU_MARGIN,
  );
  const gap = 6;
  const spaceBelow = viewportHeight - rect.bottom - gap - PORTAL_MENU_MARGIN;
  const spaceAbove = rect.top - gap - PORTAL_MENU_MARGIN;
  const clampTo = (space: number) =>
    Math.min(maxHeight, Math.max(space, minSpace));

  if (spaceBelow >= belowThreshold || spaceBelow >= spaceAbove) {
    return {
      variant: "dropdown",
      top: rect.bottom + gap,
      left,
      width,
      maxHeight: clampTo(spaceBelow),
    };
  }

  const aboveHeight = clampTo(spaceAbove);
  return {
    variant: "dropdown",
    top: Math.max(PORTAL_MENU_MARGIN, rect.top - gap - aboveHeight),
    left,
    width,
    maxHeight: aboveHeight,
  };
}

type PortalMenuProps = {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  menuId: string;
  label: string;
  role?: "listbox" | "tooltip" | "menu" | "group" | "none";
  className?: string;
  measureOptions?: MeasureMenuOptions;
  /** Enable arrow/home/end/tab cycling among focusable options. */
  arrowNav?: boolean;
  /** When set, focus this element on open and exclude it from arrow nav. */
  searchRef?: RefObject<HTMLElement | null>;
  /** Focus the first focusable option on open (when there is no searchRef). */
  focusFirstOnOpen?: boolean;
  /** Close on pointer/mousedown outside plus focus leaving the menu (tooltips). */
  dismissOnOutside?: boolean;
  children: ReactNode;
};

export function PortalMenu({
  open,
  onClose,
  triggerRef,
  menuId,
  label,
  role = "listbox",
  className,
  measureOptions,
  arrowNav = false,
  searchRef,
  focusFirstOnOpen = false,
  dismissOnOutside = true,
  children,
}: PortalMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PortalMenuPosition | null>(null);
  const focusFrameRef = useRef<number | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const measureOptionsRef = useRef(measureOptions);
  useEffect(() => {
    measureOptionsRef.current = measureOptions;
  });
  const searchRefRef = useRef(searchRef);
  useEffect(() => {
    searchRefRef.current = searchRef;
  });
  const dismissOnOutsideRef = useRef(dismissOnOutside);
  useEffect(() => {
    dismissOnOutsideRef.current = dismissOnOutside;
  });

  /**
   * Close the menu. When `restoreFocus` is true (default), focus returns to
   * the trigger on the next frame. Callers that dismiss because focus moved
   * away naturally (e.g. Tab leaving the menu) pass `false` so the focus
   * stays where the keyboard user moved it. A later `close(false)` also
   * cancels a focus-restore scheduled by an earlier `close(true)` in the
   * same interaction (e.g. pointerdown outside followed by focusin).
   */
  const close = useCallback(
    (restoreFocus = true) => {
      onCloseRef.current();
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
      if (restoreFocus) {
        focusFrameRef.current = window.requestAnimationFrame(() => {
          focusFrameRef.current = null;
          triggerRef.current?.focus();
        });
      }
    },
    [triggerRef],
  );

  if (!open && position !== null) {
    setPosition(null);
  }

  useEffect(() => {
    if (!open || !triggerRef.current) return;

    function updatePosition() {
      if (!triggerRef.current) return;
      setPosition(measureMenuPosition(triggerRef.current, measureOptionsRef.current));
    }

    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;

    let focusFrame = 0;
    if (searchRefRef.current?.current) {
      focusFrame = window.requestAnimationFrame(() => {
        searchRefRef.current?.current?.focus();
      });
    } else if (focusFirstOnOpen && menuRef.current) {
      focusFrame = window.requestAnimationFrame(() => {
        getFocusableElements(menuRef.current!)[0]?.focus();
      });
    }

    function handlePointerDown(event: MouseEvent | PointerEvent) {
      if (!dismissOnOutsideRef.current) return;
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      close();
    }

    function handleFocusIn(event: FocusEvent) {
      if (!dismissOnOutsideRef.current) return;
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      // Focus moved out of the menu (e.g. Tab). Close without yanking focus
      // back to the trigger, so the keyboard user's focus continues forward.
      close(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }

      if (!arrowNav || !menuRef.current) return;

      const items = getFocusableElements(menuRef.current);
      if (items.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const searchEl = searchRefRef.current?.current;
        if (searchEl && document.activeElement === searchEl) {
          return;
        }
        const currentIndex = items.findIndex(
          (item) => item === document.activeElement,
        );
        event.preventDefault();
        if (event.key === "ArrowDown") {
          items[(currentIndex + 1 + items.length) % items.length]?.focus();
        } else {
          items[(currentIndex - 1 + items.length) % items.length]?.focus();
        }
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        if (event.key === "Home") {
          items[0]?.focus();
        } else {
          items[items.length - 1]?.focus();
        }
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        const currentIndex = items.findIndex(
          (item) => item === document.activeElement,
        );
        if (event.shiftKey) {
          items[(currentIndex - 1 + items.length) % items.length]?.focus();
        } else {
          items[(currentIndex + 1) % items.length]?.focus();
        }
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, close, triggerRef, arrowNav, focusFirstOnOpen]);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={menuRef}
      id={menuId}
      data-portal-menu=""
      role={role === "none" ? undefined : role}
      aria-label={role === "none" ? undefined : label}
      style={{
        ...(position.variant === "sheet"
          ? {
              bottom: `max(${position.bottom ?? PORTAL_MENU_MARGIN}px, env(safe-area-inset-bottom, 0px))`,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }
          : {
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: position.maxHeight,
            }),
      }}
      className={cn(
        "fixed z-[60] flex flex-col overflow-hidden border border-hairline bg-canvas shadow-sm",
        position.variant === "sheet" ? "rounded-2xl" : "rounded-xl",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
