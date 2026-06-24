"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CheckSquare,
  LayoutDashboard,
  StickyNote,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SignOutButton } from "@/components/sign-out-button";

const navItems = [
  { href: "/", label: "儀表板", icon: LayoutDashboard },
  { href: "/contacts", label: "聯絡人", icon: Users },
  { href: "/companies", label: "公司", icon: Building2 },
  { href: "/tasks", label: "待辦事項", icon: CheckSquare },
  { href: "/notes", label: "備註紀錄", icon: StickyNote },
];

export function Sidebar({
  userName,
  userEmail,
}: {
  userName: string;
  userEmail: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-slate-900 text-white">
      <div className="border-b border-slate-800 px-6 py-5">
        <div className="text-lg font-semibold">CRM System</div>
        <div className="mt-1 text-xs text-slate-400">客戶關係管理</div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-indigo-600 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 px-4 py-4">
        <div className="mb-3 px-2">
          <div className="text-sm font-medium">{userName}</div>
          <div className="truncate text-xs text-slate-400">{userEmail}</div>
        </div>
        <SignOutButton />
      </div>
    </aside>
  );
}
