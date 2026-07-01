"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { CrmThemeToggle } from "@/components/theme/crm-theme-toggle";
import { useTranslation } from "@/i18n/provider";
import { performSecurityLogout } from "@/lib/auth/client-security";
import { getUserInitial } from "@/lib/layout/nav-links";
import { cn } from "@/lib/cn";

function AccountMenuItems({
  signingOut,
  onSignOut,
  onNavigate,
}: {
  signingOut: boolean;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <Link
        href="/account"
        role="menuitem"
        className="account-menu__item block px-4 py-2.5 text-sm"
        onClick={() => {
          onNavigate?.();
        }}
      >
        {t("nav.accountCenter")}
      </Link>
      <div className="account-menu__section-border border-t px-4 py-2.5">
        <p className="account-menu__section-label mb-1.5 text-xs font-medium">
          {t("nav.language")}
        </p>
        <LanguageSwitcher className="w-full" />
      </div>
      <div className="account-menu__section-border border-t px-4 py-2.5">
        <div className="account-menu__theme-row">
          <CrmThemeToggle />
        </div>
      </div>
      <div className="account-menu__section-border border-t">
        <button
          type="button"
          role="menuitem"
          disabled={signingOut}
          onClick={onSignOut}
          className="account-menu__sign-out w-full px-4 py-2.5 text-left text-sm disabled:opacity-50"
        >
          {signingOut ? t("auth.signingOut") : t("nav.signOut")}
        </button>
      </div>
    </>
  );
}

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

  function handleNavigate() {
    setOpen(false);
    onNavigate?.();
  }

  function handleSignOutClick() {
    void handleSignOut();
  }

  const roleLabel = role === "admin" ? t("nav.roleAdmin") : t("nav.roleStaff");
  const initial = getUserInitial(userName);

  if (collapsed) {
    return (
      <div ref={rootRef} className={cn("relative flex justify-center", className)}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2F6FB3] text-sm font-semibold text-white shadow-sm account-menu__avatar-ring"
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
            <div className="account-menu__section-border border-b px-4 py-2.5">
              <p className="truncate text-sm font-medium crm-text">{userName}</p>
              <p className="account-menu__section-label text-[10px] font-semibold uppercase tracking-wide">
                {roleLabel}
              </p>
            </div>
            <AccountMenuItems
              signingOut={signingOut}
              onSignOut={handleSignOutClick}
              onNavigate={handleNavigate}
            />
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
        className="account-menu__trigger flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2F6FB3] text-sm font-semibold text-white">
          {getUserInitial(userName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium crm-text">
            {userName}
          </span>
          <span className="account-menu__section-label block text-[10px] font-semibold uppercase tracking-wide">
            {roleLabel}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="dropdown-panel absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden py-1"
        >
          <AccountMenuItems
            signingOut={signingOut}
            onSignOut={handleSignOutClick}
            onNavigate={handleNavigate}
          />
        </div>
      )}
    </div>
  );
}
