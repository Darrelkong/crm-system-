"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  getCachedPendingApprovalCount,
  setCachedPendingApprovalCount,
} from "@/lib/approvals/pending-count-cache";

type ApprovalPendingContextValue = {
  pendingCount: number;
};

const ApprovalPendingContext = createContext<ApprovalPendingContextValue | null>(null);

export function ApprovalPendingProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);

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

  // Fetch on mount; use cache if available to avoid a flash of zero.
  useEffect(() => {
    const cached = getCachedPendingApprovalCount();
    if (cached != null) {
      setPendingCount(cached);
    }
    void refreshPendingCount({ force: cached == null });
  }, [refreshPendingCount]);

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
