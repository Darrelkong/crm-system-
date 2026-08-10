/**
 * Work Items URL state parsing and href builders.
 * Core filters live in the URL so Refresh / Back / Forward preserve state.
 */

export type WorkItemsTab = "tasks" | "notifications";
export type TasksView = "open" | "today" | "overdue" | "completed";
export type NotificationsView = "unread" | "all";

const TASK_VIEWS = new Set<TasksView>(["open", "today", "overdue", "completed"]);
const NOTIFICATION_VIEWS = new Set<NotificationsView>(["unread", "all"]);

export type ParsedWorkItemsState = {
  tab: WorkItemsTab;
  view: TasksView | NotificationsView;
  staffId: string | null;
};

/** Stable key for matching SSR task rows to the active tasks view + staff filter. */
export function buildWorkItemsTasksRequestKey(
  view: TasksView,
  staffId: string | null,
): string {
  return `${view}:${staffId ?? ""}`;
}

function firstParam(
  value: string | string[] | undefined | null,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * Parse and sanitize Work Items search params.
 * Invalid tab/view fall back safely. Staff filter only kept when role is admin.
 */
export function parseWorkItemsState(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
  options: { role: "admin" | "staff" },
): ParsedWorkItemsState {
  const get =
    params instanceof URLSearchParams
      ? (key: string) => params.get(key) ?? undefined
      : (key: string) => firstParam(params[key]);

  const tabRaw = get("tab");
  const tab: WorkItemsTab =
    tabRaw === "notifications" ? "notifications" : "tasks";

  const viewRaw = get("view");
  let view: TasksView | NotificationsView;
  if (tab === "notifications") {
    view =
      viewRaw && NOTIFICATION_VIEWS.has(viewRaw as NotificationsView)
        ? (viewRaw as NotificationsView)
        : "all";
  } else {
    view =
      viewRaw && TASK_VIEWS.has(viewRaw as TasksView)
        ? (viewRaw as TasksView)
        : "open";
  }

  let staffId: string | null = null;
  if (options.role === "admin" && tab === "tasks") {
    const staff = get("staff")?.trim();
    if (staff && isUuidLike(staff)) {
      staffId = staff;
    }
  }

  return { tab, view, staffId };
}

export function buildWorkItemsHref(input: {
  tab: WorkItemsTab;
  view: TasksView | NotificationsView;
  staffId?: string | null;
}): string {
  const qs = new URLSearchParams();
  qs.set("tab", input.tab);
  qs.set("view", input.view);
  if (input.tab === "tasks" && input.staffId && isUuidLike(input.staffId)) {
    qs.set("staff", input.staffId);
  }
  return `/work-items?${qs.toString()}`;
}

export const WORK_ITEMS_DEFAULT_HREF = buildWorkItemsHref({
  tab: "tasks",
  view: "open",
});

export const WORK_ITEMS_NOTIFICATIONS_UNREAD_HREF = buildWorkItemsHref({
  tab: "notifications",
  view: "unread",
});

export const WORK_ITEMS_NOTIFICATIONS_ALL_HREF = buildWorkItemsHref({
  tab: "notifications",
  view: "all",
});
