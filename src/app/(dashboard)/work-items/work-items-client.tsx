"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { cn } from "@/lib/cn";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { formatHongKongDateTime } from "@/lib/timezone";
import { appendWorkItemsReturnTo } from "@/lib/work-items/safe-return-to";
import {
  buildWorkItemsHref,
  type NotificationsView,
  type TasksView,
  type WorkItemsTab,
} from "@/lib/work-items/url-state";
import type {
  WorkItemStaffOption,
  WorkItemTaskCounts,
  WorkItemTaskRow,
} from "@/lib/tasks/service";
import { NotificationsClient } from "@/app/(dashboard)/notifications/notifications-client";

type Props = {
  userRole: "admin" | "staff";
  initialTab: WorkItemsTab;
  initialView: TasksView | NotificationsView;
  initialStaffId: string | null;
  taskCounts: WorkItemTaskCounts;
  pendingCount: number;
  attentionCount: number;
  staffOptions: WorkItemStaffOption[];
};

function taskTypeLabelKey(type: string): string {
  if (type === "follow_up") return "workItems.taskTypeFollowUp";
  if (type === "first_contact") return "workItems.taskTypeFirstContact";
  return "workItems.taskTypeOther";
}

function displayTaskTitle(title: string, t: (key: string) => string): string {
  // UI-only presentation for known hardcoded Chinese templates; DB unchanged.
  if (title.startsWith("跟进客户：")) {
    return `${t("workItems.taskTitleFollowUpPrefix")}${title.slice("跟进客户：".length)}`;
  }
  if (title.startsWith("首次联系客户：")) {
    return `${t("workItems.taskTitleFirstContactPrefix")}${title.slice("首次联系客户：".length)}`;
  }
  return title;
}

export function WorkItemsClient({
  userRole,
  initialTab,
  initialView,
  initialStaffId,
  taskCounts: initialTaskCounts,
  pendingCount: initialPendingCount,
  attentionCount: initialAttentionCount,
  staffOptions,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname() ?? "/work-items";
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const tab = (searchParams.get("tab") as WorkItemsTab | null) ?? initialTab;
  const viewParam = searchParams.get("view");
  const staffParam = searchParams.get("staff");

  const activeTab: WorkItemsTab =
    tab === "notifications" ? "notifications" : "tasks";
  const tasksView: TasksView =
    activeTab === "tasks" &&
    (viewParam === "today" ||
      viewParam === "overdue" ||
      viewParam === "completed" ||
      viewParam === "open")
      ? viewParam
      : activeTab === "tasks"
        ? (initialView as TasksView)
        : "open";
  const notificationsView: NotificationsView =
    activeTab === "notifications" &&
    (viewParam === "unread" || viewParam === "all")
      ? viewParam
      : activeTab === "notifications"
        ? (initialView as NotificationsView)
        : "all";
  const staffId =
    userRole === "admin"
      ? staffParam ?? initialStaffId
      : null;

  const [taskCounts, setTaskCounts] = useState(initialTaskCounts);
  const [pendingCount, setPendingCount] = useState(initialPendingCount);
  const [attentionCount, setAttentionCount] = useState(initialAttentionCount);

  const refreshNotificationCounts = useCallback(async () => {
    const res = await fetch("/api/notifications/unread-count");
    if (!res.ok) return;
    const data = (await res.json()) as {
      unreadCount?: number;
      pendingCount?: number;
      attentionCount?: number;
    };
    setPendingCount(data.pendingCount ?? 0);
    setAttentionCount(
      data.attentionCount ??
        (data.unreadCount ?? 0) + (data.pendingCount ?? 0),
    );
  }, []);
  const [tasks, setTasks] = useState<WorkItemTaskRow[]>([]);
  const [tasksLoading, setTasksLoading] = useState(activeTab === "tasks");
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const completingRef = useRef<string | null>(null);

  const replaceUrl = useCallback(
    (next: {
      tab: WorkItemsTab;
      view: TasksView | NotificationsView;
      staffId?: string | null;
    }) => {
      const href = buildWorkItemsHref(next);
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [router],
  );

  const loadTasks = useCallback(async () => {
    if (activeTab !== "tasks") return;
    setTasksLoading(true);
    setTasksError(null);
    const qs = new URLSearchParams({ view: tasksView });
    if (userRole === "admin" && staffId) qs.set("staff", staffId);
    try {
      const res = await fetch(`/api/tasks/my?${qs.toString()}`);
      const data = (await res.json()) as {
        items?: WorkItemTaskRow[];
        stats?: WorkItemTaskCounts;
        error?: string;
        errorCode?: string;
        code?: string;
      };
      if (!res.ok) {
        setTasksError(resolveApiError(t, data));
        setTasksLoading(false);
        return;
      }
      setTasks(data.items ?? []);
      if (data.stats) setTaskCounts(data.stats);
      setTasksLoading(false);
    } catch {
      setTasksError(t("workItems.loadTasksFailed"));
      setTasksLoading(false);
    }
  }, [activeTab, tasksView, staffId, userRole, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch tasks when view changes
    void loadTasks();
  }, [loadTasks]);

  const currentReturnPath = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  async function completeTask(taskId: string) {
    if (completingRef.current) return;
    completingRef.current = taskId;
    setCompletingId(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/complete`, {
        method: "PATCH",
      });
      const data = (await res.json()) as {
        error?: string;
        errorCode?: string;
        code?: string;
      };
      if (!res.ok) {
        setTasksError(resolveApiError(t, data));
        return;
      }
      setTasks((prev) => prev.filter((row) => row.id !== taskId));
      setTaskCounts((prev) => ({
        ...prev,
        open: Math.max(0, prev.open - 1),
        today: tasksView === "today" ? Math.max(0, prev.today - 1) : prev.today,
        overdue:
          tasksView === "overdue"
            ? Math.max(0, prev.overdue - 1)
            : prev.overdue,
        completed: prev.completed + 1,
      }));
      // Refresh counts from server for accuracy across views.
      void loadTasks();
    } catch {
      setTasksError(t("workItems.completeFailed"));
    } finally {
      completingRef.current = null;
      setCompletingId(null);
    }
  }

  const emptyMessage = (() => {
    if (tasksLoading) return null;
    if (tasks.length > 0) return null;
    if (tasksView === "completed") return t("workItems.emptyCompleted");
    if (tasksView === "open" && !staffId) return t("workItems.emptyOpen");
    return t("workItems.emptyFiltered");
  })();

  return (
    <div className="space-y-4">
      <PageIntro
        title={t("workItems.title")}
        description={t("workItems.subtitle")}
        compact
      />

      <p className="text-xs crm-text-secondary">{t("workItems.rolesHint")}</p>

      <div className="flex flex-wrap gap-2 border-b crm-border pb-2">
        <button
          type="button"
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            activeTab === "tasks"
              ? "bg-[#E8F1FA] text-[#1F4E79]"
              : "crm-text-secondary hover:bg-[#F5F8FB]",
          )}
          onClick={() =>
            replaceUrl({ tab: "tasks", view: "open", staffId })
          }
        >
          {t("workItems.tabTasks")}
          <span className="ml-2 text-xs tabular-nums">{taskCounts.open}</span>
        </button>
        <button
          type="button"
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            activeTab === "notifications"
              ? "bg-[#E8F1FA] text-[#1F4E79]"
              : "crm-text-secondary hover:bg-[#F5F8FB]",
          )}
          onClick={() =>
            replaceUrl({ tab: "notifications", view: "unread" })
          }
        >
          {t("workItems.tabNotifications")}
          <span className="ml-2 text-xs tabular-nums">{attentionCount}</span>
        </button>
      </div>

      {activeTab === "tasks" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["open", "workItems.viewOpen", taskCounts.open],
                ["today", "workItems.viewToday", taskCounts.today],
                ["overdue", "workItems.viewOverdue", taskCounts.overdue],
                ["completed", "workItems.viewCompleted", taskCounts.completed],
              ] as const
            ).map(([key, labelKey, count]) => (
              <button
                key={key}
                type="button"
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  tasksView === key
                    ? "border-[#2F6FB3] bg-[#F3F8FC] text-[#1F4E79]"
                    : "crm-border crm-text-secondary hover:bg-[#F7FAFD]",
                )}
                onClick={() =>
                  replaceUrl({ tab: "tasks", view: key, staffId })
                }
              >
                {t(labelKey)}
                <span className="ml-1 tabular-nums opacity-80">{count}</span>
              </button>
            ))}

            {userRole === "admin" && (
              <label className="ml-auto flex min-w-[10rem] flex-1 items-center gap-2 text-xs sm:max-w-xs">
                <span className="shrink-0 crm-text-secondary">
                  {t("workItems.staffFilter")}
                </span>
                <select
                  className="min-h-11 w-full rounded-lg border crm-border bg-transparent px-2 py-2 text-sm"
                  value={staffId ?? ""}
                  onChange={(e) =>
                    replaceUrl({
                      tab: "tasks",
                      view: tasksView,
                      staffId: e.target.value || null,
                    })
                  }
                >
                  <option value="">{t("workItems.allCompany")}</option>
                  {staffOptions.map((opt) => (
                    <option key={opt.userId} value={opt.userId}>
                      {opt.displayName}
                      {opt.isFormer ? ` (${t("workItems.former")})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {tasksError && (
            <p className="text-sm text-red-700" role="alert">
              {tasksError}
            </p>
          )}

          {tasksLoading || isPending ? (
            <p className="text-sm crm-text-secondary">{t("workItems.loading")}</p>
          ) : emptyMessage ? (
            <p className="text-sm crm-text-secondary">{emptyMessage}</p>
          ) : (
            <ul className="space-y-3 md:space-y-0 md:divide-y md:overflow-hidden md:rounded-xl md:border md:crm-border">
              {tasks.map((task) => {
                const customerHref =
                  task.customerId && task.customerAccessible
                    ? appendWorkItemsReturnTo(
                        `/customers/${task.customerId}`,
                        currentReturnPath,
                      )
                    : null;
                const completing = completingId === task.id;
                return (
                  <li
                    key={task.id}
                    className="surface-card p-4 md:rounded-none md:border-0 md:bg-transparent md:p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="accent">
                            {t(taskTypeLabelKey(task.type))}
                          </Badge>
                          {task.overdue && task.status === "open" && (
                            <Badge variant="danger">
                              {t("workItems.overdueBadge")}
                            </Badge>
                          )}
                          {task.status === "completed" && (
                            <Badge variant="accent">
                              {t("workItems.completedBadge")}
                            </Badge>
                          )}
                        </div>
                        <p className="line-clamp-2 text-sm font-medium text-[#172033] sm:line-clamp-2">
                          {displayTaskTitle(task.title, t)}
                        </p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs crm-text-secondary">
                          {task.dueAt && (
                            <span>
                              {t("workItems.dueAt")}:{" "}
                              {formatHongKongDateTime(task.dueAt)}
                            </span>
                          )}
                          {task.completedAt && (
                            <span>
                              {t("workItems.completedAt")}:{" "}
                              {formatHongKongDateTime(task.completedAt)}
                            </span>
                          )}
                          {userRole === "admin" && task.assigneeName && (
                            <span>
                              {t("workItems.assignee")}: {task.assigneeName}
                              {task.assigneeIsFormer
                                ? ` (${t("workItems.former")})`
                                : ""}
                            </span>
                          )}
                          {task.customerName ? (
                            customerHref ? (
                              <Link
                                href={customerHref}
                                className="link-primary"
                              >
                                {t("workItems.viewCustomer")}: {task.customerName}
                              </Link>
                            ) : (
                              <span>
                                {t("workItems.customerUnavailable")}
                              </span>
                            )
                          ) : task.customerId ? (
                            <span>{t("workItems.customerUnavailable")}</span>
                          ) : null}
                        </div>
                      </div>
                      {task.status === "open" && (
                        <Button
                          type="button"
                          variant="secondary"
                          className="min-h-11 shrink-0 self-stretch sm:self-start"
                          disabled={completing || completingId != null}
                          onClick={() => void completeTask(task.id)}
                        >
                          {completing
                            ? t("workItems.completing")
                            : t("workItems.markComplete")}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <NotificationsClient
          userRole={userRole}
          controlledUnreadOnly={notificationsView === "unread"}
          pendingCount={pendingCount}
          onUnreadOnlyChange={(unreadOnly) =>
            replaceUrl({
              tab: "notifications",
              view: unreadOnly ? "unread" : "all",
            })
          }
          onUnreadCountChange={() => {
            void refreshNotificationCounts();
          }}
        />
      )}
    </div>
  );
}
