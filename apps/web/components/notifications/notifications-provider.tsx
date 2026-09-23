"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { countUnreadInAppNotifications } from "@/app/actions/notifications";
import {
  applyAllRead,
  applyOneRead,
  shouldCatchUpOnVisible,
} from "@/lib/notifications/unread-state";

const POLL_INTERVAL_MS = 60_000;

type NotificationsContextValue = {
  unread: number;
  /** Re-fetch from the server (deduplicated, silenced errors). */
  refreshUnread: () => Promise<void>;
  /** Apply a known single-mark-as-read delta — no query. */
  noteOneRead: () => void;
  /** Apply a known mark-all-as-read delta — no query. */
  noteAllRead: () => void;
  /**
   * Overwrite the count from a fully-fetched list (zero queries).
   * Use only when the list is complete (no further pages).
   */
  syncFromList: (unreadFromCompleteList: number) => void;
};

const NotificationsContext =
  createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [unread, setUnread] = useState(0);
  const inFlightRef = useRef<Promise<number> | null>(null);
  const lastFetchAtRef = useRef(0);

  const refreshUnread = useCallback(async () => {
    // Dedup: if a fetch is already in-flight, piggyback on it.
    if (inFlightRef.current) {
      void inFlightRef.current;
      return;
    }

    const p = countUnreadInAppNotifications()
      .then((count) => {
        lastFetchAtRef.current = Date.now();
        setUnread(count);
        return count;
      })
      .catch(() => {
        // Transient error — keep the last-known count.
        return 0;
      })
      .finally(() => {
        inFlightRef.current = null;
      });

    inFlightRef.current = p;
    void p;
  }, []);

  const noteOneRead = useCallback(() => {
    setUnread((n) => applyOneRead(n));
  }, []);

  const noteAllRead = useCallback(() => {
    setUnread(applyAllRead());
  }, []);

  const syncFromList = useCallback((n: number) => {
    setUnread(n);
  }, []);

  // Bootstrap — fetch once per document load (layout persists across soft navs).
  useEffect(() => {
    void refreshUnread();
  }, [refreshUnread]);

  // Polling — skipped while the tab is hidden.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) {
        void refreshUnread();
      }
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [refreshUnread]);

  // Catch-up — when the tab becomes visible after a long absence.
  useEffect(() => {
    function onVisibilityChange() {
      if (
        document.visibilityState === "visible" &&
        shouldCatchUpOnVisible(
          lastFetchAtRef.current,
          Date.now(),
          POLL_INTERVAL_MS,
        )
      ) {
        void refreshUnread();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshUnread]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      unread,
      refreshUnread,
      noteOneRead,
      noteAllRead,
      syncFromList,
    }),
    [unread, refreshUnread, noteOneRead, noteAllRead, syncFromList],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error(
      "useNotifications must be used within a <NotificationsProvider>",
    );
  }
  return ctx;
}
