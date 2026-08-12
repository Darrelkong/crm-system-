import { and, eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { writeFieldChangeLogEntry } from "@/lib/customers/field-change-log";
import {
  isPendingNamePlaceholder,
  type CustomerNameStatus,
} from "@/lib/customers/name-status";
import { isValidCustomerName } from "@/lib/customers/validation";
import {
  listCustomerAssignees,
  type CustomerAssigneeRecord,
} from "@/lib/customers/assignees";
import { isArchivedCustomer } from "@/lib/customers/archived";
import { isPublicPoolCustomer } from "@/lib/permissions/customers";
import { schema, type Database } from "@/lib/db";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

export const CUSTOMER_NAME_CONFIRMED_AUDIT_ACTION = "customer.name.confirmed";

/** English UI labels must never be accepted as confirm-name payload. */
const FORBIDDEN_CONFIRM_NAME_LABELS = new Set([
  "Mr. X",
  "Ms. X",
  "Mr.X",
  "Ms.X",
  "mr. x",
  "ms. x",
  "mr.x",
  "ms.x",
]);

export class ConfirmNameError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ConfirmNameError";
  }
}

export type ConfirmCustomerNameInput = {
  customer: Customer;
  actor: User;
  customerName: unknown;
  now?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ConfirmCustomerNameResult = {
  id: string;
  customerName: string;
  nameStatus: Extract<CustomerNameStatus, "confirmed">;
};

function extractChanges(result: unknown): number | null {
  if (
    result &&
    typeof result === "object" &&
    "meta" in result &&
    result.meta &&
    typeof result.meta === "object" &&
    "changes" in result.meta &&
    typeof (result.meta as { changes: unknown }).changes === "number"
  ) {
    return (result.meta as { changes: number }).changes;
  }
  return null;
}

export function normalizeConfirmCustomerName(
  value: unknown,
): { ok: true; customerName: string } | { ok: false; code: string; message: string } {
  if (typeof value !== "string") {
    return {
      ok: false,
      code: "INVALID_CUSTOMER_NAME",
      message: "请输入客户真实姓名",
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: false,
      code: "INVALID_CUSTOMER_NAME",
      message: "请输入客户真实姓名",
    };
  }

  if (
    isPendingNamePlaceholder(trimmed) ||
    FORBIDDEN_CONFIRM_NAME_LABELS.has(trimmed) ||
    FORBIDDEN_CONFIRM_NAME_LABELS.has(trimmed.toLowerCase())
  ) {
    return {
      ok: false,
      code: "PLACEHOLDER_NAME_NOT_ALLOWED",
      message: "请输入客户真实姓名，不能使用待确认占位称呼",
    };
  }

  if (!isValidCustomerName(trimmed)) {
    return {
      ok: false,
      code: "INVALID_CUSTOMER_NAME",
      message: "客户姓名格式不正确",
    };
  }

  return { ok: true, customerName: trimmed };
}

function assertActorEligible(actor: User): void {
  if (actor.deletedAt) {
    throw new ConfirmNameError(
      "ACTOR_DELETED",
      "账号不可用",
      403,
    );
  }
  if (actor.isActive !== 1) {
    throw new ConfirmNameError(
      "ACTOR_DISABLED",
      "账号已禁用",
      403,
    );
  }
}

function assertCustomerEligibleForConfirm(customer: Customer): void {
  if (customer.deletedAt || isArchivedCustomer(customer)) {
    throw new ConfirmNameError(
      "CUSTOMER_ARCHIVED",
      "归档客户不可确认姓名",
      403,
    );
  }
  if (isPublicPoolCustomer(customer)) {
    throw new ConfirmNameError(
      "CUSTOMER_IN_PUBLIC_POOL",
      "公共池客户不可确认姓名",
      403,
    );
  }
  if (customer.nameStatus !== "pending") {
    throw new ConfirmNameError(
      "NAME_ALREADY_CONFIRMED",
      "姓名可能已被其他人确认，请重新整理客户资料",
      409,
    );
  }
}

function assertStaffConfirmNameAssigneeEligibility(
  actor: User,
  customer: Customer,
  assignees: CustomerAssigneeRecord[],
): void {
  if (customer.ownerId === actor.id) {
    return;
  }

  const self = assignees.find((row) => row.userId === actor.id);
  if (self && self.role !== "collaborator") {
    return;
  }

  throw new ConfirmNameError(
    "PERMISSION_DENIED",
    "无权确认该客户姓名",
    403,
  );
}

/**
 * Read-only confirm-name permission from a request-local assignee snapshot.
 */
export function assertCanConfirmPendingCustomerNameFromAssignees(
  actor: User,
  customer: Customer,
  assignees: CustomerAssigneeRecord[],
): void {
  assertActorEligible(actor);
  assertCustomerEligibleForConfirm(customer);

  if (actor.role === "admin") {
    return;
  }

  if (actor.role !== "staff") {
    throw new ConfirmNameError(
      "PERMISSION_DENIED",
      "无权确认该客户姓名",
      403,
    );
  }

  assertStaffConfirmNameAssigneeEligibility(actor, customer, assignees);
}

/**
 * Permission for one-shot pending → confirmed name update.
 * Allows Admin, owner, and active non-collaborator assignees.
 * Does not reuse follow-up permission (collaborators can follow up).
 */
export async function assertCanConfirmPendingCustomerName(
  db: Database,
  actor: User,
  customer: Customer,
): Promise<void> {
  assertActorEligible(actor);
  assertCustomerEligibleForConfirm(customer);

  if (actor.role === "admin") {
    return;
  }

  if (actor.role !== "staff") {
    throw new ConfirmNameError(
      "PERMISSION_DENIED",
      "无权确认该客户姓名",
      403,
    );
  }

  const assignees = await listCustomerAssignees(db, customer.id);
  assertStaffConfirmNameAssigneeEligibility(actor, customer, assignees);
}

export async function canConfirmPendingCustomerName(
  db: Database,
  actor: User,
  customer: Customer,
  options?: { preloadedAssignees?: CustomerAssigneeRecord[] },
): Promise<boolean> {
  try {
    if (options?.preloadedAssignees) {
      assertCanConfirmPendingCustomerNameFromAssignees(
        actor,
        customer,
        options.preloadedAssignees,
      );
    } else {
      await assertCanConfirmPendingCustomerName(db, actor, customer);
    }
    return true;
  } catch {
    return false;
  }
}

export async function confirmCustomerName(
  db: Database,
  input: ConfirmCustomerNameInput,
): Promise<ConfirmCustomerNameResult> {
  const { customer, actor } = input;
  await assertCanConfirmPendingCustomerName(db, actor, customer);

  const normalized = normalizeConfirmCustomerName(input.customerName);
  if (!normalized.ok) {
    throw new ConfirmNameError(normalized.code, normalized.message, 400);
  }

  const now = input.now ?? new Date().toISOString();
  const previousName = customer.customerName;

  const result = await db
    .update(schema.customers)
    .set({
      customerName: normalized.customerName,
      nameStatus: "confirmed",
      updatedAt: now,
      updatedBy: actor.id,
    })
    .where(
      and(
        eq(schema.customers.id, customer.id),
        eq(schema.customers.nameStatus, "pending"),
      ),
    );

  const changes = extractChanges(result);
  if (changes === 0) {
    throw new ConfirmNameError(
      "NAME_ALREADY_CONFIRMED",
      "姓名可能已被其他人确认，请重新整理客户资料",
      409,
    );
  }

  if (changes !== 1) {
    const freshRows = await db
      .select({
        customerName: schema.customers.customerName,
        nameStatus: schema.customers.nameStatus,
      })
      .from(schema.customers)
      .where(eq(schema.customers.id, customer.id))
      .limit(1);
    const fresh = freshRows[0];
    if (
      !fresh ||
      fresh.nameStatus !== "confirmed" ||
      fresh.customerName !== normalized.customerName
    ) {
      throw new ConfirmNameError(
        "NAME_ALREADY_CONFIRMED",
        "姓名可能已被其他人确认，请重新整理客户资料",
        409,
      );
    }
  }

  await writeFieldChangeLogEntry(
    customer.id,
    "customer_name",
    previousName,
    normalized.customerName,
    actor.id,
  );

  await writeAuditLog(
    {
      userId: actor.id,
      action: CUSTOMER_NAME_CONFIRMED_AUDIT_ACTION,
      entityType: "customer",
      entityId: customer.id,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: {
        customerId: customer.id,
        previousNameStatus: "pending",
        newNameStatus: "confirmed",
        actorId: actor.id,
        actorRole: actor.role,
      },
    },
    db,
  );

  return {
    id: customer.id,
    customerName: normalized.customerName,
    nameStatus: "confirmed",
  };
}
