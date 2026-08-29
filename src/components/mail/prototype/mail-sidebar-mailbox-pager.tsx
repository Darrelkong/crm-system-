"use client";

import { cn } from "@/lib/cn";

export function MailSidebarMailboxPager({
  page,
  totalPages,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <div
      className={cn(
        "mail-sidebar-mailbox-pager flex items-center justify-between px-2.5 py-1 text-xs crm-text-secondary",
        className,
      )}
    >
      <button
        type="button"
        disabled={page <= 0}
        onClick={() => onPageChange(page - 1)}
        className="rounded px-1.5 py-0.5 hover:crm-text disabled:opacity-40"
        aria-label="Previous mailbox page"
      >
        ‹
      </button>
      <span className="tabular-nums">
        {page + 1} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages - 1}
        onClick={() => onPageChange(page + 1)}
        className="rounded px-1.5 py-0.5 hover:crm-text disabled:opacity-40"
        aria-label="Next mailbox page"
      >
        ›
      </button>
    </div>
  );
}
