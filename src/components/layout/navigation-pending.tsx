"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

type NavigationPendingContextValue = {
  pendingHref: string | null;
  setPendingHref: (href: string | null) => void;
};

const NavigationPendingContext =
  createContext<NavigationPendingContextValue | null>(null);

export function NavigationPendingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const activePendingHref =
    pendingHref != null && !isSameNavTarget(pendingHref, pathname)
      ? pendingHref
      : null;

  return (
    <NavigationPendingContext.Provider
      value={{ pendingHref: activePendingHref, setPendingHref }}
    >
      {children}
    </NavigationPendingContext.Provider>
  );
}

export function useNavigationPending() {
  return useContext(NavigationPendingContext);
}

export function beginNavigationPending(
  pending: NavigationPendingContextValue | null,
  href: string,
  currentPathname: string,
) {
  if (!pending) {
    return;
  }
  if (isSameNavTarget(href, currentPathname)) {
    return;
  }
  pending.setPendingHref(href);
}

export function isSameNavTarget(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
