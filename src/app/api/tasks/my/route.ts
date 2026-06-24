export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import {
  listOpenTasksForUser,
  formatTaskForApi,
  countTaskStatsForUser,
} from "@/lib/tasks/service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const tasks = await listOpenTasksForUser(user);
    const stats = await countTaskStatsForUser(user);

    return Response.json({
      items: tasks.map((t) => formatTaskForApi(t)),
      total: tasks.length,
      stats,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
