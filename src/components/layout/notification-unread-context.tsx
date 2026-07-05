"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { NOTIFICATION_UNREAD_CHANGED_EVENT } from "@/lib/notifications/badge-count";
import {
  getCachedUnreadCount,
  invalidateUnreadCountCache,
  setCachedUnreadCount,
} from "@/lib/notifications/unread-count-cache";

type NotificationUnreadContextValue = {
  unreadCount: number;
  refreshUnreadCount: () => Promise<void>;
};

const NotificationUnreadContext =
  createContext<NotificationUnreadContextValue | null>(null);

export function NotificationUnreadProvider({ children }: { children: ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnreadCount = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    if (!force) {
      const cached = getCachedUnreadCount();
      if (cached != null) {
        setUnreadCount(cached);
        return;
      }
    }

    try {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as { unreadCount?: number };
      const count = data.unreadCount ?? 0;
      setCachedUnreadCount(count);
      setUnreadCount(count);
    } catch {
      /* ignore network errors for nav badge */
    }
  }, []);

  // Fetch on mount; use cache if available to avoid a flash of zero.
  useEffect(() => {
    const cached = getCachedUnreadCount();
    if (cached != null) {
      setUnreadCount(cached);
    }
    void refreshUnreadCount({ force: cached == null });
  }, [refreshUnreadCount]);

  // Force-refresh whenever a notification is marked read/unread elsewhere.
  useEffect(() => {
    const handleChange = () => {
      invalidateUnreadCountCache();
      void refreshUnreadCount({ force: true });
    };
    window.addEventListener(NOTIFICATION_UNREAD_CHANGED_EVENT, handleChange);
    return () => {
      window.removeEventListener(NOTIFICATION_UNREAD_CHANGED_EVENT, handleChange);
    };
  }, [refreshUnreadCount]);

  return (
    <NotificationUnreadContext.Provider
      value={{
        unreadCount,
        refreshUnreadCount: () => refreshUnreadCount({ force: true }),
      }}
    >
      {children}
    </NotificationUnreadContext.Provider>
  );
}

export function useNotificationUnreadCount(): number {
  const ctx = useContext(NotificationUnreadContext);
  return ctx?.unreadCount ?? 0;
}
