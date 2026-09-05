"use client";

import { Info } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type PopoverPosition = {
  top: number;
  left: number;
  width: number;
};

type FieldInfoContextValue = {
  openId: string | null;
  setOpenId: (id: string | null) => void;
};

const FieldInfoContext = createContext<FieldInfoContextValue | null>(null);

export function FieldInfoProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);

  return (
    <FieldInfoContext.Provider value={value}>
      {children}
    </FieldInfoContext.Provider>
  );
}

function measureInfoPopoverPosition(trigger: HTMLButtonElement): PopoverPosition {
  const rect = trigger.getBoundingClientRect();
  const width = 240;
  const margin = 8;
  const left = Math.min(
    Math.max(margin, rect.right - width),
    window.innerWidth - width - margin,
  );

  return {
    top: rect.bottom + 6,
    left,
    width,
  };
}

export function FieldInfoButton({ info }: { info: string }) {
  const id = useId();
  const popoverId = useId();
  const fieldInfo = useContext(FieldInfoContext);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [localOpen, setLocalOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const open = fieldInfo ? fieldInfo.openId === id : localOpen;

  function close() {
    if (fieldInfo) {
      fieldInfo.setOpenId(null);
      return;
    }
    setLocalOpen(false);
  }

  function setOpen(nextOpen: boolean) {
    if (fieldInfo) {
      fieldInfo.setOpenId(nextOpen ? id : null);
      return;
    }
    setLocalOpen(nextOpen);
  }

  useEffect(() => {
    if (!open || !buttonRef.current) return;

    function updatePosition() {
      if (!buttonRef.current) return;
      setPosition(measureInfoPopoverPosition(buttonRef.current));
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    function isInsideTooltip(target: Node) {
      return (
        buttonRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      );
    }

    function handleDismissPointerDown(event: Event) {
      const target = event.target as Node;
      if (isInsideTooltip(target)) return;
      close();
    }

    function handleFocusIn(event: FocusEvent) {
      const target = event.target as Node;
      if (isInsideTooltip(target)) return;
      close();
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      buttonRef.current?.focus();
    }

    document.addEventListener("mousedown", handleDismissPointerDown, true);
    document.addEventListener("pointerdown", handleDismissPointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("keydown", handleEscape, true);

    return () => {
      document.removeEventListener("mousedown", handleDismissPointerDown, true);
      document.removeEventListener("pointerdown", handleDismissPointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("keydown", handleEscape, true);
    };
  }, [open, fieldInfo]);

  const popover =
    open && position
      ? createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            data-field-info-menu=""
            role="tooltip"
            onPointerDown={() => close()}
            className="fixed z-[70] cursor-default rounded-xl border border-hairline bg-canvas px-3 py-2 text-sm leading-snug text-ink shadow-sm"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
          >
            {info}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`More information: ${info}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen(!open)}
        className="pointer-events-auto inline-flex size-7 items-center justify-center rounded-full text-ink-muted-48 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[open=true]:text-ink"
        data-open={open}
      >
        <Info className="size-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
      {popover}
    </>
  );
}
