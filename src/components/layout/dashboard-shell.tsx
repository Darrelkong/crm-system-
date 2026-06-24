import { SignOutButton } from "@/components/sign-out-button";

export function DashboardShell({
  title,
  roleLabel,
  userName,
  userEmail,
  children,
}: {
  title: string;
  roleLabel: string;
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
