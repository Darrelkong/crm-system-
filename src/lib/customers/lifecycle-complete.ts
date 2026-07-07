import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { writeFieldChangeLogEntry } from "@/lib/customers/field-change-log";
import { schema, type Database } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export const CUSTOMER_LIFECYCLE_COMPLETED = "completed" as const;

export type CustomerLifecycleStatus = typeof CUSTOMER_LIFECYCLE_COMPLETED;

export const CUSTOMER_LIFECYCLE_COMPLETED_AUDIT_ACTION =
  "customer.lifecycle.completed";

export class LifecycleCompleteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "LifecycleCompleteError";
  }
}

export type CompleteCustomerLifecycleInput = {
  customer: Customer;
  actor: User;
  notes?: string | null;
  now?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type CompleteCustomerLifecycleResult = {
  id: string;
  lifecycleStatus: CustomerLifecycleStatus;
  lifecycleCompletedAt: string;
  lifecycleCompletedBy: string;
  lifecycleCompletionNotes: string | null;
  salesStage: string;
  status: string;
};

function normalizeNotes(notes?: string | null): string | null {
  if (notes === null || notes === undefined) return null;
  const trimmed = notes.trim();
  return trimmed === "" ? null : trimmed;
}

export function assertCanCompleteCustomerLifecycle(
  customer: Customer,
  actor: User,
): void {
  if (actor.role !== "admin") {
    throw new LifecycleCompleteError(
      "ADMIN_REQUIRED",
      "需要管理员权限",
      403,
    );
  }

  if (customer.salesStage !== "paid") {
    throw new LifecycleCompleteError(
      "CUSTOMER_NOT_PAID",
      "仅已付款客户可标记为已完结",
    );
  }

  if (customer.lifecycleStatus === CUSTOMER_LIFECYCLE_COMPLETED) {
    throw new LifecycleCompleteError(
      "ALREADY_COMPLETED",
      "客户已标记为已完结",
      409,
    );
  }

  if (customer.status === "archived" || customer.deletedAt) {
    throw new LifecycleCompleteError(
      "CUSTOMER_ARCHIVED",
      "归档客户不可标记为已完结",
    );
  }

  if (customer.status === "public_pool") {
    throw new LifecycleCompleteError(
      "CUSTOMER_IN_PUBLIC_POOL",
      "公共池客户不可标记为已完结",
    );
  }
}

export async function completeCustomerLifecycle(
  db: Database,
  input: CompleteCustomerLifecycleInput,
): Promise<CompleteCustomerLifecycleResult> {
  const { customer, actor } = input;
  assertCanCompleteCustomerLifecycle(customer, actor);

  const now = input.now ?? new Date().toISOString();
  const previousLifecycleStatus = customer.lifecycleStatus ?? null;
  const lifecycleCompletionNotes = normalizeNotes(input.notes);

  await db
    .update(schema.customers)
    .set({
      lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
      lifecycleCompletedAt: now,
      lifecycleCompletedBy: actor.id,
      lifecycleCompletionNotes,
      updatedBy: actor.id,
      updatedAt: now,
    })
    .where(eq(schema.customers.id, customer.id));

  await writeFieldChangeLogEntry(
    customer.id,
    "lifecycle_status",
    previousLifecycleStatus,
    CUSTOMER_LIFECYCLE_COMPLETED,
    actor.id,
  );

  await writeAuditLog(
    {
      userId: actor.id,
      action: CUSTOMER_LIFECYCLE_COMPLETED_AUDIT_ACTION,
      entityType: "customer",
      entityId: customer.id,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: {
        customerName: customer.customerName,
        salesStage: customer.salesStage,
        previousLifecycleStatus,
        lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
        lifecycleCompletionNotes,
      },
    },
    db,
  );

  return {
    id: customer.id,
    lifecycleStatus: CUSTOMER_LIFECYCLE_COMPLETED,
    lifecycleCompletedAt: now,
    lifecycleCompletedBy: actor.id,
    lifecycleCompletionNotes,
    salesStage: customer.salesStage,
    status: customer.status,
  };
}
