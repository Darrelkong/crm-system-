"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { NOTIFICATION_UNREAD_CHANGED_EVENT } from "@/lib/notifications/badge-count";

type NotificationUnreadContextValue = {
  unreadCount: number;
  refreshUnreadCount: () => Promise<void>;
};

const NotificationUnreadContext =
  createContext<NotificationUnreadContextValue | null>(null);

export function NotificationUnreadProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as { unreadCount?: number };
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      /* ignore network errors for nav badge */
    }
  }, []);

  useEffect(() => {
    void refreshUnreadCount();
  }, [refreshUnreadCount, pathname]);

  useEffect(() => {
    const handleChange = () => {
      void refreshUnreadCount();
    };
    window.addEventListener(NOTIFICATION_UNREAD_CHANGED_EVENT, handleChange);
    return () => {
      window.removeEventListener(NOTIFICATION_UNREAD_CHANGED_EVENT, handleChange);
    };
  }, [refreshUnreadCount]);

  return (
    <NotificationUnreadContext.Provider
      value={{ unreadCount, refreshUnreadCount }}
    >
      {children}
    </NotificationUnreadContext.Provider>
  );
}

export function useNotificationUnreadCount(): number {
  const ctx = useContext(NotificationUnreadContext);
  return ctx?.unreadCount ?? 0;
}
