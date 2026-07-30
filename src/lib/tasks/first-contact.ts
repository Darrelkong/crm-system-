import { and, asc, eq, ne } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export type UpsertFirstContactTaskForClaimInput = {
  db: Database;
  customerId: string;
  actorId: string;
  customerName: string;
  dueAt: string;
  now: string;
};

export type UpsertFirstContactTaskForClaimResult = {
  taskId: string;
  createdNewTask: boolean;
  reusedExistingTask: boolean;
  deduplicatedExistingTasks: boolean;
  previousAssigneeId: string | null;
  dueAtChanged: boolean;
};

function buildFirstContactTitle(customerName: string): string {
  return `首次联系客户：${customerName}`;
}

/**
 * Ensures at most one open first_contact task for a claimed customer.
 * Server-only — never accept taskId / assignee / dueAt from the client.
 */
export async function upsertFirstContactTaskForClaim(
  input: UpsertFirstContactTaskForClaimInput,
): Promise<UpsertFirstContactTaskForClaimResult> {
  const { db, customerId, actorId, customerName, dueAt, now } = input;
  const title = buildFirstContactTitle(customerName);

  const openRows = await db
    .select({
      id: schema.tasks.id,
      assignedTo: schema.tasks.assignedTo,
      dueAt: schema.tasks.dueAt,
      createdAt: schema.tasks.createdAt,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.customerId, customerId),
        eq(schema.tasks.type, "first_contact"),
        eq(schema.tasks.status, "open"),
      ),
    )
    .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.id));

  if (openRows.length === 0) {
    const taskId = crypto.randomUUID();
    await db.insert(schema.tasks).values({
      id: taskId,
      customerId,
      assignedTo: actorId,
      createdBy: actorId,
      title,
      type: "first_contact",
      status: "open",
      dueAt,
      createdAt: now,
      updatedAt: now,
    });

    return {
      taskId,
      createdNewTask: true,
      reusedExistingTask: false,
      deduplicatedExistingTasks: false,
      previousAssigneeId: null,
      dueAtChanged: true,
    };
  }

  const canonical = openRows[0]!;
  const extras = openRows.slice(1);
  const previousAssigneeId = canonical.assignedTo;
  const dueAtChanged = canonical.dueAt !== dueAt;

  const updateCanonical = db
    .update(schema.tasks)
    .set({
      assignedTo: actorId,
      dueAt,
      title,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.tasks.id, canonical.id),
        eq(schema.tasks.customerId, customerId),
        eq(schema.tasks.type, "first_contact"),
        eq(schema.tasks.status, "open"),
      ),
    );

  if (extras.length === 0) {
    await updateCanonical;
  } else {
    const cancelExtras = db
      .update(schema.tasks)
      .set({
        status: "cancelled",
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.tasks.customerId, customerId),
          eq(schema.tasks.type, "first_contact"),
          eq(schema.tasks.status, "open"),
          ne(schema.tasks.id, canonical.id),
        ),
      );

    await db.batch(
      [updateCanonical, cancelExtras] as unknown as Parameters<
        Database["batch"]
      >[0],
    );
  }

  return {
    taskId: canonical.id,
    createdNewTask: false,
    reusedExistingTask: true,
    deduplicatedExistingTasks: extras.length > 0,
    previousAssigneeId,
    dueAtChanged,
  };
}
