import Link from "next/link";
import { cn } from "@/lib/cn";

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

type PaginationProps = {
  page: number;
  pageCount: number;
  buildHref?: (page: number) => string;
  onPageChange?: (page: number) => void;
  prevLabel: string;
  nextLabel: string;
  className?: string;
};

function getVisiblePageNumbers(
  current: number,
  totalPages: number,
): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: Array<number | "ellipsis"> = [1];

  if (current > 3) {
    pages.push("ellipsis");
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (current < totalPages - 2) {
    pages.push("ellipsis");
  }

  pages.push(totalPages);
  return pages;
}

const controlBase =
  "inline-flex min-h-9 min-w-9 items-center justify-center rounded-xl px-3 text-sm font-medium transition-all duration-200";

const pageButtonClass =
  "text-[#6B7890] hover:bg-[#E8F1FA] hover:text-[#172033]";

const activePageClass =
  "bg-[#2F6FB3] text-white shadow-[0_2px_8px_rgba(47,111,179,0.28)] pointer-events-none";

const disabledClass = "cursor-not-allowed text-[#B8C2D0]";

function PaginationControl({
  targetPage,
  disabled,
  buildHref,
  onPageChange,
  className,
  children,
  ariaLabel,
}: {
  targetPage: number;
  disabled: boolean;
  buildHref?: (page: number) => string;
  onPageChange?: (page: number) => void;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  if (disabled) {
    return (
      <span
        className={cn(controlBase, disabledClass, className)}
        aria-disabled="true"
      >
        {children}
      </span>
    );
  }

  if (onPageChange) {
    return (
      <button
        type="button"
        onClick={() => onPageChange(targetPage)}
        className={cn(controlBase, pageButtonClass, className)}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  }

  if (buildHref) {
    return (
      <Link
        href={buildHref(targetPage)}
        className={cn(controlBase, pageButtonClass, className)}
        aria-label={ariaLabel}
      >
        {children}
      </Link>
    );
  }

  return null;
}

export function Pagination({
  page,
  pageCount,
  buildHref,
  onPageChange,
  prevLabel,
  nextLabel,
  className,
}: PaginationProps) {
  if (pageCount <= 1) {
    return null;
  }

  const pages = getVisiblePageNumbers(page, pageCount);

  return (
    <nav
      className={cn(
        "flex flex-wrap items-center justify-center gap-1.5 pt-6",
        className,
      )}
      aria-label="Pagination"
    >
      <PaginationControl
        targetPage={page - 1}
        disabled={page <= 1}
        buildHref={buildHref}
        onPageChange={onPageChange}
        className="px-3.5"
        ariaLabel={prevLabel}
      >
        {prevLabel}
      </PaginationControl>

      {pages.map((item, index) =>
        item === "ellipsis" ? (
          <span
            key={`ellipsis-${index}`}
            className={cn(controlBase, "px-2 text-[#B8C2D0]")}
            aria-hidden="true"
          >
            …
          </span>
        ) : item === page ? (
          <span
            key={item}
            className={cn(controlBase, activePageClass)}
            aria-current="page"
          >
            {item}
          </span>
        ) : (
          <PaginationControl
            key={item}
            targetPage={item}
            disabled={false}
            buildHref={buildHref}
            onPageChange={onPageChange}
            ariaLabel={`Page ${item}`}
          >
            {item}
          </PaginationControl>
        ),
      )}

      <PaginationControl
        targetPage={page + 1}
        disabled={page >= pageCount}
        buildHref={buildHref}
        onPageChange={onPageChange}
        className="px-3.5"
        ariaLabel={nextLabel}
      >
        {nextLabel}
      </PaginationControl>
    </nav>
  );
}

export function buildCustomerListHref(params: {
  page?: number;
  createdBy?: string;
  status?: "archived";
  heat?: string;
  completenessBelow?: string;
}): string {
  const search = new URLSearchParams();

  if (params.status === "archived") {
    search.set("status", "archived");
  }
  if (params.createdBy) {
    search.set("createdBy", params.createdBy);
  }
  if (params.heat) {
    search.set("heat", params.heat);
  }
  if (params.completenessBelow) {
    search.set("completenessBelow", params.completenessBelow);
  }
  if (params.page && params.page > 1) {
    search.set("page", String(params.page));
  }

  const query = search.toString();
  return query ? `/customers?${query}` : "/customers";
}
