export const MAILBOX_SIDEBAR_PAGE_SIZE = 10;

export function paginateSidebarMailboxes<T>(
  items: readonly T[],
  page: number,
): {
  pageItems: T[];
  totalPages: number;
  showPager: boolean;
  safePage: number;
} {
  const totalPages = Math.max(1, Math.ceil(items.length / MAILBOX_SIDEBAR_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * MAILBOX_SIDEBAR_PAGE_SIZE;
  return {
    pageItems: items.slice(start, start + MAILBOX_SIDEBAR_PAGE_SIZE),
    totalPages,
    showPager: items.length > MAILBOX_SIDEBAR_PAGE_SIZE,
    safePage,
  };
}

export function mailboxSidebarPageForSelection<T>(
  items: readonly T[],
  selectedId: string | null | undefined,
  getId: (item: T) => string,
): number {
  if (!selectedId) return 0;
  const index = items.findIndex((item) => getId(item) === selectedId);
  if (index < 0) return 0;
  return Math.floor(index / MAILBOX_SIDEBAR_PAGE_SIZE);
}
