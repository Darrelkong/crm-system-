import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getEffectiveSettings } from "@/lib/settings/effective";
import {
  countCustomerAssignees,
  replaceCustomerPrimaryAssignee,
} from "@/lib/public-pool/assignee-sync";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export async function createFirstContactTask(
  customer: Customer,
  assigneeId: string,
  createdBy: string,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<string> {
  const db = getDb();
  const settings = await getEffectiveSettings(db);
  const now = new Date();
  const dueAt = new Date(
    now.getTime() + settings.firstContactSlaHours * 60 * 60 * 1000,
  ).toISOString();
  const taskId = crypto.randomUUID();
  const isoNow = now.toISOString();

  await db.insert(schema.tasks).values({
    id: taskId,
    customerId: customer.id,
    assignedTo: assigneeId,
    createdBy,
    title: `首次联系客户：${customer.customerName}`,
    type: "first_contact",
    status: "open",
    dueAt,
    createdAt: isoNow,
    updatedAt: isoNow,
  });

  await writeAuditLog({
    userId: createdBy,
    action: "task.created.first_contact",
    entityType: "task",
    entityId: taskId,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
    metadata: { customerId: customer.id, dueAt },
  });

  return taskId;
}

export type ClaimCustomerFromPoolResult =
  | { ok: true; taskId: string }
  | { ok: false; reason: "already_claimed" };

export async function claimCustomerFromPool(
  customer: Customer,
  user: User,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<ClaimCustomerFromPoolResult> {
  const db = getDb();
  const now = new Date().toISOString();

  const updatedRows = await db
    .update(schema.customers)
    .set({
      ownerId: user.id,
      status: "active",
      claimedBy: user.id,
      claimedAt: now,
      poolLeftAt: now,
      updatedBy: user.id,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.customers.id, customer.id),
        eq(schema.customers.status, "public_pool"),
        isNull(schema.customers.ownerId),
      ),
    )
    .returning({ id: schema.customers.id });

  if (updatedRows.length === 0) {
    return { ok: false, reason: "already_claimed" };
  }

  let clearedAssigneeCount = 0;
  try {
    const syncResult = await replaceCustomerPrimaryAssignee(db, {
      customerId: customer.id,
      userId: user.id,
      assignedBy: user.id,
      now,
    });
    clearedAssigneeCount = syncResult.clearedAssigneeCount;
  } catch (error) {
    await db
      .update(schema.customers)
      .set({
        ownerId: null,
        status: "public_pool",
        claimedBy: null,
        claimedAt: null,
        poolLeftAt: null,
        updatedBy: customer.updatedBy,
        updatedAt: customer.updatedAt,
      })
      .where(
        and(
          eq(schema.customers.id, customer.id),
          eq(schema.customers.ownerId, user.id),
          eq(schema.customers.status, "active"),
        ),
      );
    throw error;
  }

  const updated = { ...customer, customerName: customer.customerName };
  const taskId = await createFirstContactTask(updated, user.id, user.id, audit);

  await writeAuditLog({
    userId: user.id,
    action: "customer.claimed_from_pool",
    entityType: "customer",
    entityId: customer.id,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
    metadata: {
      customerName: customer.customerName,
      taskId,
      previousReleasedBy: customer.releasedBy ?? customer.releaserUserId,
      primaryAssigneeSynced: true,
      clearedAssigneeCount,
    },
  });

  return { ok: true, taskId };
}

export async function releaseCustomerToPool(
  customer: Customer,
  user: User,
  reason: string,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const previousOwnerId = customer.ownerId;
  const clearedAssigneeCount = await countCustomerAssignees(db, customer.id);

  await db.batch([
    db
      .update(schema.customers)
      .set({
        ownerId: null,
        status: "public_pool",
        poolEnteredAt: now,
        poolReason: reason.trim(),
        releasedBy: user.id,
        releaserUserId: user.id,
        previousOwnerId,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(schema.customers.id, customer.id)),
    db
      .delete(schema.customerAssignees)
      .where(eq(schema.customerAssignees.customerId, customer.id)),
  ] as unknown as Parameters<typeof db.batch>[0]);

  await writeAuditLog({
    userId: user.id,
    action: "customer.released_to_pool",
    entityType: "customer",
    entityId: customer.id,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
    metadata: {
      customerName: customer.customerName,
      poolReason: reason.trim(),
      previousOwnerId,
      clearedAssigneeCount,
    },
  });
}
