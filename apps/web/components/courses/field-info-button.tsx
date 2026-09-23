"use client";

import { Info } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { PortalMenu } from "@/components/ui/portal-menu";

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

export function FieldInfoButton({ info }: { info: string }) {
  const id = useId();
  const popoverId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fieldInfo = useContext(FieldInfoContext);
  const [localOpen, setLocalOpen] = useState(false);

  const open = fieldInfo ? fieldInfo.openId === id : localOpen;

  const close = useCallback(() => {
    if (fieldInfo) {
      fieldInfo.setOpenId(null);
      return;
    }
    setLocalOpen(false);
  }, [fieldInfo]);

  function setOpen(nextOpen: boolean) {
    if (fieldInfo) {
      fieldInfo.setOpenId(nextOpen ? id : null);
      return;
    }
    setLocalOpen(nextOpen);
  }

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

      <PortalMenu
        open={open}
        onClose={close}
        triggerRef={buttonRef}
        menuId={popoverId}
        label={info}
        role="tooltip"
        className="z-[70] w-60 cursor-default px-3 py-2 text-sm leading-snug text-ink"
        measureOptions={{ minWidth: 240, maxHeight: 240 }}
      >
        <span onPointerDown={() => close()}>{info}</span>
      </PortalMenu>
    </>
  );
}