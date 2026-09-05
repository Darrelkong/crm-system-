"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardList,
  Clock,
  Inbox,
  MonitorSmartphone,
  TrendingUp,
  Users,
  Waves,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

const KPI_ICON_WRAP = {
  default: "kpi-icon-wrap",
  warning: "kpi-icon-wrap-warning",
  danger: "kpi-icon-wrap-danger",
} as const;

const KPI_VALUE = {
  default: "kpi-value",
  warning: "kpi-value-warning",
  danger: "kpi-value-danger",
} as const;

const KPI_ACCENT = {
  default: "kpi-accent-default",
  warning: "kpi-accent-warning",
  danger: "kpi-accent-danger",
} as const;

export function KpiCard({
  label,
  value,
  hint,
  variant = "default",
  icon: Icon = Users,
  compact = false,
}: {
  label: string;
  value: number | string;
  hint?: React.ReactNode;
  variant?: "default" | "warning" | "danger";
  icon?: LucideIcon;
  /** Tighter padding/typography for Reports; Dashboard keeps default. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "interactive-card group relative overflow-hidden",
        compact ? "p-3.5 sm:p-4" : "p-5",
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1 opacity-90",
          KPI_ACCENT[variant],
        )}
      />
      <div className={cn("flex items-start justify-between", compact ? "gap-2" : "gap-3")}>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "kpi-label font-semibold uppercase tracking-wider",
              compact ? "line-clamp-2 text-[10px] leading-snug" : "text-[11px]",
            )}
          >
            {label}
          </p>
          <p
            className={cn(
              "font-semibold tracking-tight",
              compact ? "mt-1.5 text-2xl sm:text-[1.65rem]" : "mt-2 text-3xl",
              KPI_VALUE[variant],
            )}
          >
            {value}
          </p>
          {hint && (
            <p
              className={cn(
                "kpi-hint text-xs leading-relaxed",
                compact ? "mt-1.5" : "mt-2",
              )}
            >
              {hint}
            </p>
          )}
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl transition-transform duration-200 ease-out group-hover:scale-105",
            compact ? "h-9 w-9" : "h-11 w-11",
            KPI_ICON_WRAP[variant],
          )}
        >
          <Icon className={cn(compact ? "h-4 w-4" : "h-5 w-5")} aria-hidden />
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
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="min-w-0 flex-1 break-words crm-text-secondary">
          {label}
        </span>
        <span className="kpi-value shrink-0 font-semibold tabular-nums">
          {count}
        </span>
      </div>
      <div className="kpi-bar-track h-2 overflow-hidden rounded-full">
        <div
          className="kpi-bar-fill h-full rounded-full transition-all duration-300 ease-out"
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
  emptyMessage,
  note,
  scrollable = false,
}: {
  title: string;
  columns: [string, string];
  rows: {
    id?: string;
    name: string;
    count: number;
    /** Optional quiet labels (e.g. Admin / Former). Omitted rows look unchanged. */
    badges?: string[];
  }[];
  /** Required i18n string — avoid hardcoded locale fallbacks. */
  emptyMessage: string;
  /** Optional quiet scope note under the title. */
  note?: string;
  /** When true, list scrolls vertically instead of growing unboundedly. */
  scrollable?: boolean;
}) {
  return (
    <div>
      <h3 className="section-title mb-3 sm:mb-4">{title}</h3>
      {note ? (
        <p className="mb-3 text-xs leading-relaxed crm-text-secondary">{note}</p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm crm-text-secondary">{emptyMessage}</p>
      ) : (
        <div
          className={
            scrollable ? "max-h-80 overflow-y-auto overscroll-contain" : undefined
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="ranking-table-head text-left">
                <th className="th-label pb-2.5 text-xs font-semibold uppercase tracking-wide">
                  {columns[0]}
                </th>
                <th className="th-label pb-2.5 text-right text-xs font-semibold uppercase tracking-wide">
                  {columns[1]}
                </th>
              </tr>
            </thead>
            <tbody className="crm-divide-y divide-y">
              {rows.map((row) => (
                <tr key={row.id ?? row.name} className="table-row">
                  <td className="td-body min-w-0 py-2.5 break-words">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="min-w-0 break-words">{row.name}</span>
                      {row.badges?.map((badge) => (
                        <span
                          key={badge}
                          className="shrink-0 rounded-md border crm-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide crm-text-secondary"
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="td-body py-2.5 text-right font-semibold tabular-nums whitespace-nowrap">
                    {row.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <h3 className="section-title text-base">{labels.title}</h3>
      <div className="workflow-tabs-border mt-4 flex gap-1 border-b">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "workflow-tab relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors duration-200",
              tab === item.id && "tab-underline-active",
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="workflow-tab-count ml-1.5 rounded-full px-1.5 py-0.5 text-xs">
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
              <li className="priority-row flex items-center gap-3 rounded-xl px-4 py-3 transition-colors duration-200">
                <ClipboardList className="h-5 w-5 crm-text-primary" />
                <span className="text-sm crm-text">{labels.pendingApprovals}</span>
                <span className="ml-auto font-semibold crm-text-primary">
                  {pendingApprovals}
                </span>
              </li>
            )}
            {overdueTasks > 0 && (
              <li className="priority-row-danger flex items-center gap-3 rounded-xl px-4 py-3 transition-colors duration-200">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <span className="text-sm crm-text">{labels.overdueTasks}</span>
                <span className="ml-auto font-semibold text-red-700">{overdueTasks}</span>
              </li>
            )}
            {todayTasks > 0 && (
              <li className="priority-row flex items-center gap-3 rounded-xl px-4 py-3 transition-colors duration-200">
                <Clock className="h-5 w-5 crm-text-primary" />
                <span className="text-sm crm-text">{labels.todayTasks}</span>
                <span className="ml-auto font-semibold crm-text-primary">{todayTasks}</span>
              </li>
            )}
            {pendingApprovals === 0 && overdueTasks === 0 && todayTasks === 0 && (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="empty-state-icon-wrap mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <p className="text-sm crm-text-secondary">{labels.empty}</p>
              </div>
            )}
          </ul>
        )}
        {tab === "approvals" && (
          <div className="flex flex-col items-center py-10 text-center">
            <Inbox className="mb-3 h-10 w-10 crm-text-muted" />
            <p className="text-2xl font-semibold crm-text">{pendingApprovals}</p>
            <p className="mt-1 text-sm crm-text-secondary">{labels.pendingApprovals}</p>
          </div>
        )}
        {tab === "tasks" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="stat-mini-card rounded-xl p-4 text-center">
              <p className="text-2xl font-semibold crm-text">{todayTasks}</p>
              <p className="mt-1 text-xs crm-text-secondary">{labels.todayTasks}</p>
            </div>
            <div className="stat-mini-card-danger rounded-xl p-4 text-center">
              <p className="text-2xl font-semibold text-red-800">{overdueTasks}</p>
              <p className="mt-1 text-xs crm-text-secondary">{labels.overdueTasks}</p>
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
        <p className="mt-1 text-sm text-white/75">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <TrendingUp className="mb-3 h-10 w-10 text-white/60" />
          <p className="text-sm text-white/70">{emptyMessage}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          <li className="flex px-3 text-xs font-semibold uppercase tracking-wide text-white/65">
            <span className="flex-1">{columnLabels[0]}</span>
            <span>{columnLabels[1]}</span>
          </li>
          {rows.slice(0, 6).map((row, index) => (
            <li
              key={row.name}
              className="performance-list-item flex items-center gap-3 px-3 py-2.5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/20 text-xs font-bold">
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
  devices: MonitorSmartphone,
  trend: TrendingUp,
};
