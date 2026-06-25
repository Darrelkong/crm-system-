"use client";

import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useTranslation } from "@/i18n/provider";

export type NavLink = { href: string; labelKey: string; active?: boolean };

export function DashboardShell({
  titleKey,
  role,
  userName,
  userEmail,
  navLinks,
  children,
}: {
  titleKey: string;
  role: "admin" | "staff";
  userName: string;
  userEmail: string;
  navLinks?: NavLink[];
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const roleLabel = role === "admin" ? "Admin" : "Staff";

  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-indigo-600">
                {roleLabel}
              </p>
              <h1 className="truncate text-lg font-semibold text-slate-900">
                {t(titleKey)}
              </h1>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4">
              <LanguageSwitcher />
              <div className="hidden text-right text-sm sm:block">
                <p className="font-medium text-slate-900">{userName}</p>
                <p className="truncate text-slate-500">{userEmail}</p>
              </div>
              <SignOutButton />
            </div>
          </div>
          {navLinks && navLinks.length > 0 && (
            <nav className="-mb-px flex gap-4 overflow-x-auto pb-px sm:gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    link.active
                      ? "shrink-0 border-b-2 border-indigo-600 pb-3 text-sm font-medium text-indigo-600"
                      : "shrink-0 border-b-2 border-transparent pb-3 text-sm font-medium text-slate-500 hover:text-slate-800"
                  }
                >
                  {t(link.labelKey)}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
