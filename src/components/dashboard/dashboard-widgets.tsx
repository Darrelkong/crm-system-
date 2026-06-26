"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardList,
  Clock,
  Inbox,
  TrendingUp,
  Users,
  Waves,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

const KPI_ACCENTS = {
  default: "from-[#2F6FB3] to-[#37B6C9]",
  warning: "from-amber-500 to-amber-400",
  danger: "from-red-500 to-rose-400",
} as const;

const KPI_ICON_BG = {
  default: "bg-[#E8F1FA] text-[#2F6FB3]",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-red-50 text-red-700",
} as const;

export function KpiCard({
  label,
  value,
  hint,
  variant = "default",
  icon: Icon = Users,
}: {
  label: string;
  value: number | string;
  hint?: React.ReactNode;
  variant?: "default" | "warning" | "danger";
  icon?: LucideIcon;
}) {
  const valueStyles = {
    default: "text-[#172033]",
    warning: "text-amber-900",
    danger: "text-red-800",
  };

  return (
    <div className="interactive-card group relative overflow-hidden p-5">
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1 bg-gradient-to-r opacity-90",
          KPI_ACCENTS[variant],
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7890]">
            {label}
          </p>
          <p
            className={cn(
              "mt-2 text-3xl font-semibold tracking-tight",
              valueStyles[variant],
            )}
          >
            {value}
          </p>
          {hint && (
            <p className="mt-2 text-xs leading-relaxed text-[#6B7890]">{hint}</p>
          )}
        </div>
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 ease-out group-hover:scale-105",
            KPI_ICON_BG[variant],
          )}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      </div>
    </div>
  );
}

export function SimpleBarRow({
  label,
  count,
  max,
}: {
  label: string;
  count: number;
  max: number;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[#6B7890]">{label}</span>
        <span className="font-semibold text-[#172033]">{count}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#EEF3F8]">
        <div
          className="h-full rounded-full bg-[#2F6FB3] transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function RankingTable({
  title,
  columns,
  rows,
  emptyMessage = "暂无数据",
}: {
  title: string;
  columns: [string, string];
  rows: { name: string; count: number }[];
  emptyMessage?: string;
}) {
  return (
    <div>
      <h3 className="mb-4 text-sm font-semibold text-[#172033]">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-[#6B7890]">{emptyMessage}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E3E8F0] text-left text-[#6B7890]">
              <th className="pb-2.5 text-xs font-semibold uppercase tracking-wide">
                {columns[0]}
              </th>
              <th className="pb-2.5 text-right text-xs font-semibold uppercase tracking-wide">
                {columns[1]}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF3F8]">
            {rows.map((row) => (
              <tr
                key={row.name}
                className="table-row transition-colors duration-200 hover:bg-[#E8F1FA]"
              >
                <td className="py-2.5 text-[#172033]">{row.name}</td>
                <td className="py-2.5 text-right font-semibold text-[#172033]">
                  {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

type WorkflowTab = "priorities" | "approvals" | "tasks";

export function WorkflowPrioritiesPanel({
  pendingApprovals,
  overdueTasks,
  todayTasks,
  labels,
}: {
  pendingApprovals: number;
  overdueTasks: number;
  todayTasks: number;
  labels: {
    title: string;
    priorities: string;
    approvals: string;
    tasks: string;
    empty: string;
    pendingApprovals: string;
    overdueTasks: string;
    todayTasks: string;
  };
}) {
  const [tab, setTab] = useState<WorkflowTab>("priorities");

  const tabs: { id: WorkflowTab; label: string; count?: number }[] = [
    { id: "priorities", label: labels.priorities },
    { id: "approvals", label: labels.approvals, count: pendingApprovals },
    { id: "tasks", label: labels.tasks, count: overdueTasks + todayTasks },
  ];

  return (
    <div className="surface-card p-6">
      <h3 className="text-base font-semibold text-[#172033]">{labels.title}</h3>
      <div className="mt-4 flex gap-1 border-b border-[#E3E8F0]">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors duration-200",
              tab === item.id
                ? "text-[#2F6FB3] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#2F6FB3]"
                : "text-[#6B7890] hover:text-[#172033]",
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="ml-1.5 rounded-full bg-[#E8F1FA] px-1.5 py-0.5 text-xs text-[#2F6FB3]">
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="mt-5">
        {tab === "priorities" && (
          <ul className="space-y-2">
            {pendingApprovals > 0 && (
              <li className="flex items-center gap-3 rounded-xl border border-[#E3E8F0] bg-[#F7F9FC] px-4 py-3 transition-colors duration-200 hover:bg-[#E8F1FA]">
                <ClipboardList className="h-5 w-5 text-[#2F6FB3]" />
                <span className="text-sm text-[#172033]">{labels.pendingApprovals}</span>
                <span className="ml-auto font-semibold text-[#2F6FB3]">{pendingApprovals}</span>
              </li>
            )}
            {overdueTasks > 0 && (
              <li className="flex items-center gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 transition-colors duration-200 hover:bg-red-100">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <span className="text-sm text-[#172033]">{labels.overdueTasks}</span>
                <span className="ml-auto font-semibold text-red-700">{overdueTasks}</span>
              </li>
            )}
            {todayTasks > 0 && (
              <li className="flex items-center gap-3 rounded-xl border border-[#E3E8F0] bg-[#F7F9FC] px-4 py-3 transition-colors duration-200 hover:bg-[#E8F1FA]">
                <Clock className="h-5 w-5 text-[#2F6FB3]" />
                <span className="text-sm text-[#172033]">{labels.todayTasks}</span>
                <span className="ml-auto font-semibold text-[#2F6FB3]">{todayTasks}</span>
              </li>
            )}
            {pendingApprovals === 0 && overdueTasks === 0 && todayTasks === 0 && (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E8F1FA] text-[#2F6FB3]">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <p className="text-sm text-[#6B7890]">{labels.empty}</p>
              </div>
            )}
          </ul>
        )}
        {tab === "approvals" && (
          <div className="flex flex-col items-center py-10 text-center">
            <Inbox className="mb-3 h-10 w-10 text-[#A8B4C4]" />
            <p className="text-2xl font-semibold text-[#172033]">{pendingApprovals}</p>
            <p className="mt-1 text-sm text-[#6B7890]">{labels.pendingApprovals}</p>
          </div>
        )}
        {tab === "tasks" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E3E8F0] bg-[#F7F9FC] p-4 text-center">
              <p className="text-2xl font-semibold text-[#172033]">{todayTasks}</p>
              <p className="mt-1 text-xs text-[#6B7890]">{labels.todayTasks}</p>
            </div>
            <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-center">
              <p className="text-2xl font-semibold text-red-800">{overdueTasks}</p>
              <p className="mt-1 text-xs text-[#6B7890]">{labels.overdueTasks}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TeamPerformancePanel({
  title,
  subtitle,
  rows,
  emptyMessage,
  columnLabels,
}: {
  title: string;
  subtitle: string;
  rows: { name: string; count: number }[];
  emptyMessage: string;
  columnLabels: [string, string];
}) {
  return (
    <div className="performance-panel flex h-full flex-col p-6 text-white">
      <div className="mb-5">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-sm text-[#D4E8F8]">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <TrendingUp className="mb-3 h-10 w-10 text-[#A8CCE8]" />
          <p className="text-sm text-[#C5DAF0]">{emptyMessage}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          <li className="flex px-3 text-xs font-semibold uppercase tracking-wide text-[#B8D4EC]">
            <span className="flex-1">{columnLabels[0]}</span>
            <span>{columnLabels[1]}</span>
          </li>
          {rows.slice(0, 6).map((row, index) => (
            <li
              key={row.name}
              className="performance-list-item flex items-center gap-3 px-3 py-2.5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#4A8FD4] text-xs font-bold">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
              <span className="font-semibold tabular-nums">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const kpiIcons = {
  users: Users,
  archive: Archive,
  waves: Waves,
  clipboard: ClipboardList,
  clock: Clock,
  alert: AlertTriangle,
  trend: TrendingUp,
};
