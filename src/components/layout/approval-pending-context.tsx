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
import {
  getCachedPendingApprovalCount,
  setCachedPendingApprovalCount,
} from "@/lib/approvals/pending-count-cache";

type ApprovalPendingContextValue = {
  pendingCount: number;
};

const ApprovalPendingContext = createContext<ApprovalPendingContextValue | null>(null);

const PATHNAME_DEBOUNCE_MS = 300;

export function ApprovalPendingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [pendingCount, setPendingCount] = useState(0);
  const pathnameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPendingCount = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    if (!force) {
      const cached = getCachedPendingApprovalCount();
      if (cached != null) {
        setPendingCount(cached);
        return;
      }
    }

    try {
      const res = await fetch("/api/approvals/pending-count");
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as { pendingCount?: number };
      const val = data.pendingCount ?? 0;
      setCachedPendingApprovalCount(val);
      setPendingCount(val);
    } catch {
      /* ignore network errors — nav badge degrades gracefully */
    }
  }, []);

  useEffect(() => {
    const cached = getCachedPendingApprovalCount();
    if (cached != null) {
      setPendingCount(cached);
    }
    void refreshPendingCount({ force: cached == null });
  }, [refreshPendingCount]);

  useEffect(() => {
    if (pathnameDebounceRef.current) {
      clearTimeout(pathnameDebounceRef.current);
    }
    pathnameDebounceRef.current = setTimeout(() => {
      void refreshPendingCount();
    }, PATHNAME_DEBOUNCE_MS);

    return () => {
      if (pathnameDebounceRef.current) {
        clearTimeout(pathnameDebounceRef.current);
      }
    };
  }, [pathname, refreshPendingCount]);

  return (
    <ApprovalPendingContext.Provider value={{ pendingCount }}>
      {children}
    </ApprovalPendingContext.Provider>
  );
}

export function useApprovalPendingCount(): number {
  const ctx = useContext(ApprovalPendingContext);
  return ctx?.pendingCount ?? 0;
}
