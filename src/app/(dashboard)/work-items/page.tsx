export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { requireAuthCached } from "@/lib/auth/request-cache";
import { getDb } from "@/lib/db";
import {
  getPendingActionCount,
  getWorkItemsAttentionCount,
} from "@/lib/notifications/queries";
import {
  countWorkItemTasks,
  listWorkItemStaffOptions,
  listWorkItemTasks,
} from "@/lib/tasks/service";
import {
  buildWorkItemsHref,
  parseWorkItemsState,
  type TasksView,
} from "@/lib/work-items/url-state";
import { WorkItemsClient } from "./work-items-client";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TASK_VIEWS = new Set<TasksView>(["open", "today", "overdue", "completed"]);

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function resolveTasksView(
  tab: ReturnType<typeof parseWorkItemsState>["tab"],
  view: ReturnType<typeof parseWorkItemsState>["view"],
): TasksView {
  if (
    tab === "tasks" &&
    TASK_VIEWS.has(view as TasksView)
  ) {
    return view as TasksView;
  }
  return "open";
}

export default async function WorkItemsPage({ searchParams }: Props) {
  const user = await requireAuthCached();
  const params = await searchParams;
  const state = parseWorkItemsState(params, { role: user.role });

  // Canonicalize bare /work-items into the default URL once.
  if (!firstParam(params.tab) && !firstParam(params.view)) {
    redirect(
      buildWorkItemsHref({
        tab: "tasks",
        view: "open",
        staffId: state.staffId,
      }),
    );
  }

  const db = getDb();
  const staffIdForTasks = user.role === "admin" ? state.staffId : null;
  const tasksView = resolveTasksView(state.tab, state.view);
  const isTasksTab = state.tab === "tasks";

  const [initialTasks, taskCounts, pendingCount, attentionCount, staffOptions] =
    await Promise.all([
      isTasksTab
        ? listWorkItemTasks(user, {
            view: tasksView,
            staffId: staffIdForTasks,
          })
        : Promise.resolve([]),
      countWorkItemTasks(user, {
        staffId: staffIdForTasks,
      }),
      getPendingActionCount(db, user.id),
      getWorkItemsAttentionCount(db, user.id),
      user.role === "admin" ? listWorkItemStaffOptions() : Promise.resolve([]),
    ]);

  return (
    <WorkItemsClient
      key={`${state.tab}:${tasksView}:${staffIdForTasks ?? ""}`}
      userRole={user.role}
      initialTab={state.tab}
      initialView={state.view}
      initialStaffId={state.staffId}
      initialTasks={initialTasks}
      taskCounts={taskCounts}
      pendingCount={pendingCount}
      attentionCount={attentionCount}
      staffOptions={staffOptions}
    />
  );
}
