export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getTaskById } from "@/lib/tasks/service";
import { assertCanCompleteTask } from "@/lib/permissions/tasks";
import { PermissionError } from "@/lib/permissions/customers";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getRequestMeta } from "@/lib/auth/cookies";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const { ipAddress, userAgent } = getRequestMeta(request);

    const task = await getTaskById(id);
    if (!task) {
      return Response.json({ error: "任务不存在" }, { status: 404 });
    }

    if (task.status !== "open") {
      return Response.json({ error: "任务已完成或已取消" }, { status: 400 });
    }

    try {
      assertCanCompleteTask(user, task);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: err.auditAction ?? "permission.denied.task_access",
          userId: user.id,
          entityType: "task",
          entityId: id,
        });
      }
      throw err;
    }

    const now = new Date().toISOString();
    const db = getDb();

    await db
      .update(schema.tasks)
      .set({
        status: "completed",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, id));

    await writeAuditLog({
      userId: user.id,
      action: "task.completed",
      entityType: "task",
      entityId: id,
      ipAddress,
      userAgent,
      metadata: { customerId: task.customerId, title: task.title },
    });

    return Response.json({ ok: true, id });
  } catch (error) {
    return authErrorResponse(error);
  }
}
