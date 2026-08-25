"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MailLayoutMode } from "./use-mail-workspace-layout";

const STORAGE_KEY = "echfront-mail-pane-widths-v1";

export const MAIL_PANE_DEFAULTS = {
  mailboxes: 240,
  list: 380,
} as const;

export const MAILBOX_COLLAPSE_RAIL_WIDTH = 40;

export const MAIL_PANE_LIMITS = {
  mailboxes: { min: 220, max: 260 },
  list: { min: 350, max: 420, minMedium: 300 },
  listCollapseThreshold: 260,
  reading: { min: 320 },
  resizer: 10,
} as const;

type StoredPrefs = {
  mailboxes: number;
  list: number;
  messageListCollapsed?: boolean;
  lastMessageListWidth?: number;
};

export type MailPaneWidthOptions = {
  mailboxSidebarCollapsed?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function loadStored(): StoredPrefs | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPrefs;
    if (
      typeof parsed.mailboxes === "number" &&
      typeof parsed.list === "number"
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveStored(prefs: StoredPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function resolveListMinWidth(layoutMode: MailLayoutMode): number {
  return layoutMode === "medium"
    ? MAIL_PANE_LIMITS.list.minMedium
    : MAIL_PANE_LIMITS.list.min;
}

export function computeReadingPaneFits({
  containerWidth,
  layoutMode,
  mailboxSidebarCollapsed,
  mailboxesWidth,
  messageListCollapsed,
}: {
  containerWidth: number;
  layoutMode: MailLayoutMode;
  mailboxSidebarCollapsed: boolean;
  mailboxesWidth: number;
  messageListCollapsed: boolean;
}): boolean {
  if (layoutMode === "narrow") return false;

  const resizerWidth = MAIL_PANE_LIMITS.resizer;
  const listMin = resolveListMinWidth(layoutMode);
  const readingMin = MAIL_PANE_LIMITS.reading.min;

  const mailboxSpace = mailboxSidebarCollapsed
    ? MAILBOX_COLLAPSE_RAIL_WIDTH
    : mailboxesWidth + resizerWidth;

  const listSpace = messageListCollapsed ? 0 : listMin;
  const resizers = messageListCollapsed ? 0 : resizerWidth;

  const needed = mailboxSpace + listSpace + readingMin + resizers;
  return containerWidth >= needed;
}

export function useMailPaneWidths(
  containerWidth: number,
  layoutMode: MailLayoutMode,
  options: MailPaneWidthOptions = {},
) {
  const mailboxSidebarCollapsed = options.mailboxSidebarCollapsed ?? false;

  const [mailboxesWidth, setMailboxesWidthState] = useState<number>(
    MAIL_PANE_DEFAULTS.mailboxes,
  );
  const [listWidth, setListWidthState] = useState<number>(
    MAIL_PANE_DEFAULTS.list,
  );
  const [lastMessageListWidth, setLastMessageListWidth] = useState<number>(
    MAIL_PANE_DEFAULTS.list,
  );
  const [messageListCollapsed, setMessageListCollapsed] = useState(false);
  const [dragListWidth, setDragListWidth] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const listMinWidth = resolveListMinWidth(layoutMode);
  const resizerWidth = MAIL_PANE_LIMITS.resizer;

  const effectiveMailboxWidth = mailboxSidebarCollapsed
    ? MAILBOX_COLLAPSE_RAIL_WIDTH
    : mailboxesWidth;

  useEffect(() => {
    const stored = loadStored();
    if (stored) {
      setMailboxesWidthState(
        clamp(
          stored.mailboxes,
          MAIL_PANE_LIMITS.mailboxes.min,
          MAIL_PANE_LIMITS.mailboxes.max,
        ),
      );
      const storedList = clamp(
        stored.list,
        MAIL_PANE_LIMITS.list.min,
        MAIL_PANE_LIMITS.list.max,
      );
      setListWidthState(storedList);
      setLastMessageListWidth(
        typeof stored.lastMessageListWidth === "number"
          ? clamp(
              stored.lastMessageListWidth,
              MAIL_PANE_LIMITS.list.min,
              MAIL_PANE_LIMITS.list.max,
            )
          : storedList,
      );
      setMessageListCollapsed(stored.messageListCollapsed === true);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveStored({
      mailboxes: mailboxesWidth,
      list: listWidth,
      messageListCollapsed,
      lastMessageListWidth,
    });
  }, [
    mailboxesWidth,
    listWidth,
    messageListCollapsed,
    lastMessageListWidth,
    hydrated,
  ]);

  const readingPaneFits = useMemo(
    () =>
      computeReadingPaneFits({
        containerWidth,
        layoutMode,
        mailboxSidebarCollapsed,
        mailboxesWidth,
        messageListCollapsed,
      }),
    [
      containerWidth,
      layoutMode,
      mailboxSidebarCollapsed,
      mailboxesWidth,
      messageListCollapsed,
    ],
  );

  const clampedMailboxes = useMemo(() => {
    if (mailboxSidebarCollapsed) {
      return mailboxesWidth;
    }

    const max =
      layoutMode === "narrow"
        ? MAIL_PANE_LIMITS.mailboxes.max
        : Math.min(
            MAIL_PANE_LIMITS.mailboxes.max,
            containerWidth -
              (messageListCollapsed
                ? MAIL_PANE_LIMITS.reading.min + resizerWidth
                : listMinWidth +
                  MAIL_PANE_LIMITS.reading.min +
                  resizerWidth * 2),
          );
    return clamp(
      mailboxesWidth,
      MAIL_PANE_LIMITS.mailboxes.min,
      Math.max(MAIL_PANE_LIMITS.mailboxes.min, max),
    );
  }, [
    mailboxesWidth,
    containerWidth,
    layoutMode,
    messageListCollapsed,
    mailboxSidebarCollapsed,
    listMinWidth,
    resizerWidth,
  ]);

  const maxListWidth = useMemo(() => {
    const mailboxSpace = mailboxSidebarCollapsed
      ? MAILBOX_COLLAPSE_RAIL_WIDTH
      : clampedMailboxes + resizerWidth;

    if (!readingPaneFits) {
      return Math.min(
        MAIL_PANE_LIMITS.list.max,
        Math.max(listMinWidth, containerWidth - mailboxSpace),
      );
    }

    return Math.min(
      MAIL_PANE_LIMITS.list.max,
      containerWidth -
        mailboxSpace -
        MAIL_PANE_LIMITS.reading.min -
        resizerWidth,
    );
  }, [
    containerWidth,
    clampedMailboxes,
    readingPaneFits,
    mailboxSidebarCollapsed,
    listMinWidth,
    resizerWidth,
  ]);

  const clampedList = useMemo(() => {
    return clamp(
      listWidth,
      listMinWidth,
      Math.max(listMinWidth, maxListWidth),
    );
  }, [listWidth, maxListWidth, listMinWidth]);

  const effectiveListWidth = useMemo(() => {
    if (messageListCollapsed) return 0;
    if (dragListWidth !== null) {
      return clamp(
        dragListWidth,
        MAIL_PANE_LIMITS.listCollapseThreshold,
        Math.max(MAIL_PANE_LIMITS.listCollapseThreshold, maxListWidth),
      );
    }
    return clampedList;
  }, [messageListCollapsed, dragListWidth, clampedList, maxListWidth]);

  const setMailboxesWidth = useCallback((next: number) => {
    setMailboxesWidthState(
      clamp(
        next,
        MAIL_PANE_LIMITS.mailboxes.min,
        MAIL_PANE_LIMITS.mailboxes.max,
      ),
    );
  }, []);

  const setListWidth = useCallback(
    (next: number) => {
      if (messageListCollapsed) return;
      const clamped = clamp(
        next,
        MAIL_PANE_LIMITS.listCollapseThreshold,
        Math.max(MAIL_PANE_LIMITS.listCollapseThreshold, maxListWidth),
      );
      setDragListWidth(clamped);
    },
    [messageListCollapsed, maxListWidth],
  );

  const finishListResize = useCallback(() => {
    if (dragListWidth === null) return;
    if (dragListWidth <= MAIL_PANE_LIMITS.listCollapseThreshold) {
      setLastMessageListWidth(clampedList);
      setMessageListCollapsed(true);
    } else {
      const next = clamp(
        dragListWidth,
        listMinWidth,
        Math.max(listMinWidth, maxListWidth),
      );
      setListWidthState(next);
      setLastMessageListWidth(next);
    }
    setDragListWidth(null);
  }, [dragListWidth, clampedList, maxListWidth, listMinWidth]);

  const collapseMessageList = useCallback(() => {
    setLastMessageListWidth(clampedList);
    setMessageListCollapsed(true);
    setDragListWidth(null);
  }, [clampedList]);

  const restoreMessageList = useCallback(() => {
    const restoreWidth =
      lastMessageListWidth > MAIL_PANE_LIMITS.listCollapseThreshold
        ? lastMessageListWidth
        : listWidth > MAIL_PANE_LIMITS.listCollapseThreshold
          ? listWidth
          : MAIL_PANE_DEFAULTS.list;
    const next = clamp(
      restoreWidth,
      listMinWidth,
      Math.max(listMinWidth, maxListWidth),
    );
    setListWidthState(next);
    setLastMessageListWidth(next);
    setMessageListCollapsed(false);
    setDragListWidth(null);
  }, [lastMessageListWidth, listWidth, maxListWidth, listMinWidth]);

  const toggleMessageListCollapsed = useCallback(() => {
    if (messageListCollapsed) {
      restoreMessageList();
    } else {
      collapseMessageList();
    }
  }, [messageListCollapsed, restoreMessageList, collapseMessageList]);

  const resetMailboxesWidth = useCallback(() => {
    setMailboxesWidthState(MAIL_PANE_DEFAULTS.mailboxes);
  }, []);

  const resetListWidth = useCallback(() => {
    setListWidthState(MAIL_PANE_DEFAULTS.list);
    setLastMessageListWidth(MAIL_PANE_DEFAULTS.list);
    setMessageListCollapsed(false);
    setDragListWidth(null);
  }, []);

  return {
    mailboxesWidth: clampedMailboxes,
    listWidth: effectiveListWidth,
    messageListCollapsed,
    setMailboxesWidth,
    setListWidth,
    finishListResize,
    collapseMessageList,
    restoreMessageList,
    toggleMessageListCollapsed,
    resetMailboxesWidth,
    resetListWidth,
    readingPaneFits,
    /** @deprecated use readingPaneFits */
    threeColumnFits: readingPaneFits,
    resizerWidth,
    effectiveMailboxWidth,
  };
}
