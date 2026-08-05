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
} from "@/lib/tasks/service";
import {
  buildWorkItemsHref,
  parseWorkItemsState,
} from "@/lib/work-items/url-state";
import { WorkItemsClient } from "./work-items-client";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
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
  const [taskCounts, pendingCount, attentionCount, staffOptions] =
    await Promise.all([
    countWorkItemTasks(user, {
      staffId: user.role === "admin" ? state.staffId : null,
    }),
    getPendingActionCount(db, user.id),
    getWorkItemsAttentionCount(db, user.id),
    user.role === "admin" ? listWorkItemStaffOptions() : Promise.resolve([]),
  ]);

  return (
    <WorkItemsClient
      userRole={user.role}
      initialTab={state.tab}
      initialView={state.view}
      initialStaffId={state.staffId}
      taskCounts={taskCounts}
      pendingCount={pendingCount}
      attentionCount={attentionCount}
      staffOptions={staffOptions}
    />
  );
}
