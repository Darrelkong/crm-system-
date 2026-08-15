"use client";

import Link from "next/link";
import { useLinkStatus } from "next/link";
import { useEffect, type ReactNode } from "react";
import { LoadingSpinner } from "@/components/ui/loading";
import { cn } from "@/lib/cn";
import { recordNavigationLinkPendingMark } from "@/lib/customers/customer-navigation-perf";

type NavigationPerfHandlers = {
  onPointerDown?: () => void;
  onClick?: () => void;
};

type Props = {
  href: string;
  className?: string;
  children: ReactNode;
  variant: "desktop" | "mobile";
  navigationPerfHandlers?: NavigationPerfHandlers;
  enableNavigationPerf?: boolean;
};

function CustomerDetailLinkPending({
  variant,
  enableNavigationPerf,
}: {
  variant: "desktop" | "mobile";
  enableNavigationPerf?: boolean;
}) {
  const { pending } = useLinkStatus();

  useEffect(() => {
    if (!pending || !enableNavigationPerf) {
      return;
    }
    recordNavigationLinkPendingMark();
  }, [pending, enableNavigationPerf]);

  if (!pending) {
    return null;
  }

  if (variant === "mobile") {
    return (
      <span
        className="pointer-events-none absolute right-3 top-3"
        role="status"
        aria-live="polite"
      >
        <LoadingSpinner size="sm" />
        <span className="sr-only">Opening customer</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center"
      role="status"
      aria-live="polite"
    >
      <LoadingSpinner size="sm" className="opacity-80" />
      <span className="sr-only">Opening customer</span>
    </span>
  );
}

function CustomerDetailLinkContent({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "desktop" | "mobile";
}) {
  const { pending } = useLinkStatus();

  return (
    <span
      className={cn(
        variant === "mobile" ? "block" : "inline",
        pending && "opacity-80 transition-opacity duration-150",
      )}
    >
      {children}
    </span>
  );
}

export function CustomerDetailNavLink({
  href,
  className,
  children,
  variant,
  navigationPerfHandlers,
  enableNavigationPerf = false,
}: Props) {
  if (variant === "mobile") {
    return (
      <Link
        href={href}
        className={cn(
          "interactive-card relative block p-4 active:scale-[0.99]",
          className,
        )}
        {...navigationPerfHandlers}
      >
        <CustomerDetailLinkContent variant="mobile">{children}</CustomerDetailLinkContent>
        <CustomerDetailLinkPending
          variant="mobile"
          enableNavigationPerf={enableNavigationPerf}
        />
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      {...navigationPerfHandlers}
    >
      <CustomerDetailLinkContent variant="desktop">{children}</CustomerDetailLinkContent>
      <CustomerDetailLinkPending
        variant="desktop"
        enableNavigationPerf={enableNavigationPerf}
      />
    </Link>
  );
}
