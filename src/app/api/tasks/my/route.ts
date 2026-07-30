export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import {
  countWorkItemTasks,
  listWorkItemTasks,
  listOpenTasksForUser,
  formatTaskForApi,
  countTaskStatsForUser,
} from "@/lib/tasks/service";
import type { TasksView } from "@/lib/work-items/url-state";

const TASK_VIEWS = new Set<TasksView>(["open", "today", "overdue", "completed"]);

function parseView(raw: string | null): TasksView | null {
  if (raw && TASK_VIEWS.has(raw as TasksView)) return raw as TasksView;
  return null;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * GET /api/tasks/my
 * Additive: ?view=&staff= for Work Items. Without view, keeps legacy open-list shape.
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const url = new URL(request.url);
    const view = parseView(url.searchParams.get("view"));

    if (!view) {
      const tasks = await listOpenTasksForUser(user);
      const stats = await countTaskStatsForUser(user);
      return Response.json({
        items: tasks.map((t) => formatTaskForApi(t)),
        total: tasks.length,
        stats,
      });
    }

    const staffRaw = url.searchParams.get("staff")?.trim() ?? null;
    const staffId =
      user.role === "admin" && staffRaw && isUuidLike(staffRaw)
        ? staffRaw
        : null;

    const [items, stats] = await Promise.all([
      listWorkItemTasks(user, { view, staffId }),
      countWorkItemTasks(user, { staffId }),
    ]);

    return Response.json({
      items,
      total: items.length,
      stats,
      view,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
