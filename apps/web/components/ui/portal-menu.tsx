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

  if (viewportWidth < PORTAL_MENU_SHEET_BREAKPOINT) {
    return {
      variant: "sheet",
      bottom: PORTAL_MENU_MARGIN,
      left: PORTAL_MENU_MARGIN,
      width: viewportWidth - PORTAL_MENU_MARGIN * 2,
      maxHeight: Math.min(maxHeight, viewportHeight - PORTAL_MENU_MARGIN * 2),
    };
  }

  const rect = trigger.getBoundingClientRect();
  const width = Math.min(
    Math.max(rect.width, minWidth),
    viewportWidth - PORTAL_MENU_MARGIN * 2,
  );
  const left = Math.min(
    Math.max(PORTAL_MENU_MARGIN, rect.left),
    viewportWidth - width - PORTAL_MENU_MARGIN,
  );
  const gap = 6;
  const spaceBelow = viewportHeight - rect.bottom - gap - PORTAL_MENU_MARGIN;
  const spaceAbove = rect.top - gap - PORTAL_MENU_MARGIN;
  const resolvedMaxHeight = Math.min(
    maxHeight,
    Math.max(Math.min(spaceBelow, spaceAbove), minSpace),
  );

  if (spaceBelow >= belowThreshold || spaceBelow >= spaceAbove) {
    return {
      variant: "dropdown",
      top: rect.bottom + gap,
      left,
      width,
      maxHeight: resolvedMaxHeight,
    };
  }

  return {
    variant: "dropdown",
    top: Math.max(PORTAL_MENU_MARGIN, rect.top - gap - resolvedMaxHeight),
    left,
    width,
    maxHeight: resolvedMaxHeight,
  };
}

type PortalMenuProps = {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  menuId: string;
  label: string;
  role?: "listbox" | "tooltip";
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

  const close = useCallback(() => {
    onCloseRef.current();
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, [triggerRef]);

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
      close();
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
      role={role}
      aria-label={label}
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
