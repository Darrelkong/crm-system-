import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";

export type NavLink = { href: string; label: string; active?: boolean };

export function DashboardShell({
  title,
  roleLabel,
  userName,
  userEmail,
  navLinks,
  children,
}: {
  title: string;
  roleLabel: string;
  userName: string;
  userEmail: string;
  navLinks?: NavLink[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex items-center justify-between py-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-indigo-600">
                {roleLabel}
              </p>
              <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right text-sm">
                <p className="font-medium text-slate-900">{userName}</p>
                <p className="text-slate-500">{userEmail}</p>
              </div>
              <SignOutButton />
            </div>
          </div>
          {navLinks && navLinks.length > 0 && (
            <nav className="-mb-px flex gap-6">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    link.active
                      ? "border-b-2 border-indigo-600 pb-3 text-sm font-medium text-indigo-600"
                      : "border-b-2 border-transparent pb-3 text-sm font-medium text-slate-500 hover:text-slate-800"
                  }
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
