"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
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

const PATHNAME_DEBOUNCE_MS = 300;

export function NotificationUnreadProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [unreadCount, setUnreadCount] = useState(0);
  const pathnameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    const cached = getCachedUnreadCount();
    if (cached != null) {
      setUnreadCount(cached);
    }
    void refreshUnreadCount({ force: cached == null });
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (pathnameDebounceRef.current) {
      clearTimeout(pathnameDebounceRef.current);
    }

    pathnameDebounceRef.current = setTimeout(() => {
      void refreshUnreadCount();
    }, PATHNAME_DEBOUNCE_MS);

    return () => {
      if (pathnameDebounceRef.current) {
        clearTimeout(pathnameDebounceRef.current);
      }
    };
  }, [pathname, refreshUnreadCount]);

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
