import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export async function upsertFollowUpTask(
  customer: Customer,
  nextFollowUpAt: string,
  createdBy: string,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ taskId: string; created: boolean }> {
  const db = getDb();
  const now = new Date().toISOString();
  const assignee = customer.ownerId ?? createdBy;
  const title = `跟进客户：${customer.customerName}`;

  const existing = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.customerId, customer.id),
        eq(schema.tasks.type, "follow_up"),
        eq(schema.tasks.status, "open"),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.tasks)
      .set({
        dueAt: nextFollowUpAt,
        title,
        assignedTo: assignee,
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, existing[0].id));

    await writeAuditLog({
      userId: createdBy,
      action: "task.updated",
      entityType: "task",
      entityId: existing[0].id,
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
      metadata: { customerId: customer.id, dueAt: nextFollowUpAt },
    });

    return { taskId: existing[0].id, created: false };
  }

  const taskId = crypto.randomUUID();
  await db.insert(schema.tasks).values({
    id: taskId,
    customerId: customer.id,
    assignedTo: assignee,
    createdBy,
    title,
    type: "follow_up",
    status: "open",
    dueAt: nextFollowUpAt,
    createdAt: now,
    updatedAt: now,
  });

  await writeAuditLog({
    userId: createdBy,
    action: "task.created",
    entityType: "task",
    entityId: taskId,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
    metadata: { customerId: customer.id, dueAt: nextFollowUpAt },
  });

  return { taskId, created: true };
}

export async function listOpenTasksForUser(user: User) {
  const db = getDb();
  const base = db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.status, "open"))
    .orderBy(asc(schema.tasks.dueAt));

  if (user.role === "admin") {
    return base;
  }

  return db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "open"),
        eq(schema.tasks.assignedTo, user.id),
      ),
    )
    .orderBy(asc(schema.tasks.dueAt));
}

export async function getTaskById(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export function formatTaskForApi(
  task: typeof schema.tasks.$inferSelect,
  now = new Date().toISOString(),
) {
  const overdue =
    task.status === "open" &&
    !!task.dueAt &&
    task.dueAt < now;

  return {
    id: task.id,
    customerId: task.customerId,
    assignedTo: task.assignedTo,
    title: task.title,
    type: task.type,
    status: task.status,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    overdue,
  };
}

export async function countTaskStatsForUser(user: User) {
  const tasks = await listOpenTasksForUser(user);
  const now = new Date().toISOString();
  const overdue = tasks.filter(
    (t) => t.dueAt && t.dueAt < now,
  ).length;
  return { open: tasks.length, overdue };
}
