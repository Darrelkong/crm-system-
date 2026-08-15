"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import type { ComponentType, ReactNode } from "react";
import { LoadingSpinner } from "@/components/ui/loading";
import { cn } from "@/lib/cn";

function MobileNavLinkPendingIcon({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();

  return (
    <span className="relative inline-flex">
      {children}
      {pending ? (
        <span
          className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[color:var(--crm-surface-panel,#fff)] shadow-sm dark:bg-slate-900"
          role="status"
          aria-live="polite"
        >
          <LoadingSpinner size="sm" className="h-3 w-3 border-[1.5px]" />
          <span className="sr-only">Loading page</span>
        </span>
      ) : null}
    </span>
  );
}

type Props = {
  href: string;
  isActive: boolean;
  isPending: boolean;
  onNavigate: () => void;
  icon: ComponentType<{ className?: string }>;
  label: string;
  badge?: ReactNode;
};

export function MobileBottomNavLink({
  href,
  isActive,
  isPending,
  onNavigate,
  icon: Icon,
  label,
  badge,
}: Props) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        isActive
          ? "mobile-nav-active flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-colors duration-200"
          : "mobile-nav-inactive flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-colors duration-200",
        isPending && !isActive && "nav-item-pending",
      )}
    >
      <MobileNavLinkPendingIcon>
        <span className="relative">
          <Icon className="h-5 w-5" aria-hidden />
          {badge}
        </span>
      </MobileNavLinkPendingIcon>
      <span className="max-w-full truncate">{label}</span>
    </Link>
  );
}
