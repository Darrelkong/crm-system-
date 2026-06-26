"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useTranslation } from "@/i18n/provider";
import { performSecurityLogout } from "@/lib/auth/client-security";
import { getUserInitial } from "@/lib/layout/nav-links";
import { cn } from "@/lib/cn";

export function AccountMenu({
  userName,
  role,
  className,
  onNavigate,
  collapsed = false,
}: {
  userName: string;
  role: "admin" | "staff";
  className?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  async function handleSignOut() {
    setSigningOut(true);
    await performSecurityLogout("manual");
  }

  const roleLabel = role === "admin" ? t("nav.roleAdmin") : t("nav.roleStaff");
  const initial = getUserInitial(userName);

  if (collapsed) {
    return (
      <div ref={rootRef} className={cn("relative flex justify-center", className)}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2F6FB3] text-sm font-semibold text-white shadow-sm ring-2 ring-white"
          aria-expanded={open}
          aria-haspopup="menu"
          title={userName}
        >
          {initial}
        </button>
        {open && (
          <div
            role="menu"
            className="dropdown-panel absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 overflow-hidden py-1"
          >
            <div className="border-b border-[#E3E8F0] px-4 py-2.5">
              <p className="truncate text-sm font-medium text-[#172033]">{userName}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7890]">
                {roleLabel}
              </p>
            </div>
            <Link
              href="/account"
              role="menuitem"
              className="block px-4 py-2.5 text-sm text-[#172033] hover:bg-[#F7F9FC]"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
            >
              {t("nav.accountCenter")}
            </Link>
            <div className="border-t border-[#E3E8F0] px-4 py-2.5">
              <p className="mb-1.5 text-xs font-medium text-[#6B7890]">
                {t("nav.language")}
              </p>
              <LanguageSwitcher className="w-full" />
            </div>
            <div className="border-t border-[#E3E8F0]">
              <button
                type="button"
                role="menuitem"
                disabled={signingOut}
                onClick={() => void handleSignOut()}
                className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {signingOut ? t("auth.signingOut") : t("nav.signOut")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-2.5 text-left shadow-sm ring-1 ring-[#E3E8F0] transition-colors hover:bg-[#F7F9FC]"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2F6FB3] text-sm font-semibold text-white">
          {getUserInitial(userName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[#172033]">
            {userName}
          </span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#6B7890]">
            {roleLabel}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="dropdown-panel absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden py-1"
        >
          <Link
            href="/account"
            role="menuitem"
            className="block px-4 py-2.5 text-sm text-[#172033] hover:bg-[#F7F9FC]"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
          >
            {t("nav.accountCenter")}
          </Link>
          <div className="border-t border-[#E3E8F0] px-4 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-[#6B7890]">
              {t("nav.language")}
            </p>
            <LanguageSwitcher className="w-full" />
          </div>
          <div className="border-t border-[#E3E8F0]">
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
              className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {signingOut ? t("auth.signingOut") : t("nav.signOut")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
