"use client";

import { useCallback, useSyncExternalStore } from "react";

export const SIDEBAR_COLLAPSED_KEY = "crm-sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    sidebarStoreValue = collapsed;
    sidebarStoreReady = true;
    for (const listener of sidebarListeners) {
      listener();
    }
  } catch {
    // ignore quota / private mode
  }
}

let sidebarStoreValue = false;
let sidebarStoreReady = false;
const sidebarListeners = new Set<() => void>();

function subscribeSidebar(listener: () => void): () => void {
  sidebarListeners.add(listener);
  return () => {
    sidebarListeners.delete(listener);
  };
}

function getSidebarSnapshot(): boolean {
  if (!sidebarStoreReady && typeof window !== "undefined") {
    sidebarStoreValue = readSidebarCollapsed();
    sidebarStoreReady = true;
  }
  return sidebarStoreValue;
}

function getSidebarServerSnapshot(): boolean {
  return false;
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    getSidebarSnapshot,
    getSidebarServerSnapshot,
  );

  const toggle = useCallback(() => {
    writeSidebarCollapsed(!getSidebarSnapshot());
  }, []);

  return [collapsed, toggle];
}
