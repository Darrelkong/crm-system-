import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import type { Approval } from "../../../drizzle/schema/approvals";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import {
  assertCanEditCustomer,
  PermissionError,
} from "@/lib/permissions/customers";
import { createNotificationOnce } from "@/lib/notifications/service";
import { customerNameNotificationParams } from "@/lib/notifications/customer-name";
import { listActiveAdminUsers } from "@/lib/users/queries";
import { logApprovalNotificationFailure } from "@/lib/approvals/notification-safe";
import { APPROVAL_AUDIT_ACTIONS } from "@/lib/approvals/constants";
import { ApprovalError } from "@/lib/approvals/service";
import {
  buildAdminRemovePriorityFields,
  buildAdminSetPriorityFields,
  buildApprovalSetPriorityFields,
  canRemovePriorityForStage,
  isPriorityCustomer,
  PRIORITY_ERROR_CODES,
  PRIORITY_REQUEST_TYPES,
  priorityAuditSnapshot,
  shouldSkipSetPriorityMutation,
  shouldSkipUnsetPriorityMutation,
  type PriorityRequestType,
} from "./priority-customer";

export class PriorityCustomerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errorCode: string,
  ) {
    super(message);
    this.name = "PriorityCustomerError";
  }
}

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

export async function findPendingPriorityApproval(
  db: Database,
  customerId: string,
): Promise<Approval | null> {
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.customerId, customerId),
        eq(schema.approvals.status, "pending"),
        sql`${schema.approvals.requestType} IN ('set_priority_customer', 'unset_priority_customer')`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function notifyAdminsPriorityPending(
  db: Database,
  approvalId: string,
  customer: Customer,
  requestType: PriorityRequestType,
): Promise<void> {
  let recipientIds: string[];
  try {
    const admins = await listActiveAdminUsers();
    recipientIds = [...new Set(admins.map((admin) => admin.id))];
  } catch (error) {
    logApprovalNotificationFailure({
      approvalId,
      notificationType: "approval.pending",
      error,
    });
    return;
  }

  for (const recipientUserId of recipientIds) {
    try {
      await createNotificationOnce(db, {
        userId: recipientUserId,
        type: "approval.pending",
        titleKey: "notificationTypes.approval_pending",
        messageKey: "notificationMessages.approvalPendingAdmin",
        messageParams: {
          ...customerNameNotificationParams(customer),
          approvalType: requestType,
        },
        relatedEntityType: "approval",
        relatedEntityId: approvalId,
      });
    } catch (error) {
      logApprovalNotificationFailure({
        approvalId,
        recipientUserId,
        notificationType: "approval.pending",
        error,
      });
    }
  }
}

export async function createPriorityApprovalRequest(
  db: Database,
  customer: Customer,
  user: User,
  requestType: PriorityRequestType,
  reason: string,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ id: string }> {
  try {
    assertCanEditCustomer(user, customer);
  } catch (error) {
    if (error instanceof PermissionError) {
      throw new PriorityCustomerError(
        error.status,
        error.message,
        error.auditAction ?? "permission.denied.customer_edit",
      );
    }
    throw error;
  }

  if (user.role === "admin") {
    throw new PriorityCustomerError(
      400,
      "管理员请直接执行优先客户操作",
      PRIORITY_ERROR_CODES.INVALID_PRIORITY_ACTION,
    );
  }

  if (requestType === "set_priority_customer") {
    if (isPriorityCustomer(customer)) {
      throw new PriorityCustomerError(
        409,
        "此客户目前已是优先客户，无需重复设定",
        PRIORITY_ERROR_CODES.ALREADY_PRIORITY,
      );
    }
  } else {
    if (!isPriorityCustomer(customer)) {
      throw new PriorityCustomerError(
        409,
        "此客户目前不是优先客户，无需取消",
        PRIORITY_ERROR_CODES.NOT_PRIORITY,
      );
    }
    if (!canRemovePriorityForStage(customer.salesStage)) {
      throw new PriorityCustomerError(
        409,
        "搁置中的客户会自动保持为优先客户。如需取消，请先将客户移出「搁置」阶段。",
        PRIORITY_ERROR_CODES.ON_HOLD_REQUIRES_PRIORITY,
      );
    }
  }

  const existing = await findPendingPriorityApproval(db, customer.id);
  if (existing) {
    throw new PriorityCustomerError(
      409,
      "已有优先客户相关审批正在处理",
      PRIORITY_ERROR_CODES.PENDING_PRIORITY_APPROVAL,
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const payload = JSON.stringify({
    expectedIsPinned: customer.isPinned === 1,
    expectedPinnedSource: customer.pinnedSource,
    expectedSalesStage: customer.salesStage,
  });

  await db.insert(schema.approvals).select(
    sql`
      SELECT
        ${id} AS id,
        ${requestType} AS request_type,
        ${"pending"} AS status,
        ${customer.id} AS customer_id,
        ${user.id} AS requested_by,
        NULL AS target_user_id,
        NULL AS related_customer_ids,
        ${payload} AS payload,
        ${reason} AS reason,
        NULL AS admin_comment,
        NULL AS reviewed_by,
        NULL AS reviewed_at,
        ${now} AS created_at,
        ${now} AS updated_at
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${schema.approvals}
        WHERE ${schema.approvals.customerId} = ${customer.id}
          AND ${schema.approvals.status} = 'pending'
          AND ${schema.approvals.requestType} IN ('set_priority_customer', 'unset_priority_customer')
      )
    `,
  );

  const racedDuplicate = await findPendingPriorityApproval(db, customer.id);
  if (!racedDuplicate || racedDuplicate.id !== id) {
    throw new PriorityCustomerError(
      409,
      "已有优先客户相关审批正在处理",
      PRIORITY_ERROR_CODES.PENDING_PRIORITY_APPROVAL,
    );
  }

  await writeAuditLog(
    {
      userId: user.id,
      action:
        requestType === "set_priority_customer"
          ? APPROVAL_AUDIT_ACTIONS.prioritySetRequested
          : APPROVAL_AUDIT_ACTIONS.priorityUnsetRequested,
      entityType: "approval",
      entityId: id,
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
      metadata: {
        customerId: customer.id,
        customerName: customer.customerName,
        requestType,
      },
    },
    db,
  );

  await notifyAdminsPriorityPending(db, id, customer, requestType);
  return { id };
}

export async function adminDirectSetPriority(
  db: Database,
  customer: Customer,
  admin: User,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<"updated" | "no_change"> {
  if (admin.role !== "admin") {
    throw new PriorityCustomerError(403, "权限不足", "INSUFFICIENT_PERMISSIONS");
  }

  if (shouldSkipSetPriorityMutation(customer)) {
    return "no_change";
  }

  const now = new Date().toISOString();
  const patch = buildAdminSetPriorityFields(now);
  const previous = priorityAuditSnapshot(customer);

  await db
    .update(schema.customers)
    .set({
      ...patch,
      updatedBy: admin.id,
      updatedAt: now,
    })
    .where(eq(schema.customers.id, customer.id));

  await writeAuditLog(
    {
      userId: admin.id,
      action: APPROVAL_AUDIT_ACTIONS.priorityAdminSet,
      entityType: "customer",
      entityId: customer.id,
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
      metadata: {
        previous,
        next: priorityAuditSnapshot({
          ...customer,
          ...patch,
        }),
      },
    },
    db,
  );

  return "updated";
}

export async function adminDirectRemovePriority(
  db: Database,
  customer: Customer,
  admin: User,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<"updated" | "no_change"> {
  if (admin.role !== "admin") {
    throw new PriorityCustomerError(403, "权限不足", "INSUFFICIENT_PERMISSIONS");
  }

  if (!isPriorityCustomer(customer)) {
    throw new PriorityCustomerError(
      409,
      "此客户目前不是优先客户，无需取消",
      PRIORITY_ERROR_CODES.NOT_PRIORITY,
    );
  }

  if (!canRemovePriorityForStage(customer.salesStage)) {
    throw new PriorityCustomerError(
      409,
      "搁置中的客户会自动保持为优先客户。如需取消，请先将客户移出「搁置」阶段。",
      PRIORITY_ERROR_CODES.ON_HOLD_REQUIRES_PRIORITY,
    );
  }

  const now = new Date().toISOString();
  const patch = buildAdminRemovePriorityFields();
  const previous = priorityAuditSnapshot(customer);

  await db
    .update(schema.customers)
    .set({
      ...patch,
      updatedBy: admin.id,
      updatedAt: now,
    })
    .where(eq(schema.customers.id, customer.id));

  await writeAuditLog(
    {
      userId: admin.id,
      action: APPROVAL_AUDIT_ACTIONS.priorityAdminRemoved,
      entityType: "customer",
      entityId: customer.id,
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
      metadata: {
        previous,
        next: priorityAuditSnapshot({
          ...customer,
          ...patch,
        }),
      },
    },
    db,
  );

  return "updated";
}

function parsePriorityApprovalPayload(approval: Approval): {
  expectedIsPinned: boolean;
  expectedPinnedSource: string | null;
  expectedSalesStage: string;
} | null {
  if (!approval.payload) return null;
  try {
    const parsed = JSON.parse(approval.payload) as Record<string, unknown>;
    if (
      typeof parsed.expectedIsPinned !== "boolean" ||
      typeof parsed.expectedSalesStage !== "string"
    ) {
      return null;
    }
    return {
      expectedIsPinned: parsed.expectedIsPinned,
      expectedPinnedSource:
        typeof parsed.expectedPinnedSource === "string"
          ? parsed.expectedPinnedSource
          : parsed.expectedPinnedSource == null
            ? null
            : null,
      expectedSalesStage: parsed.expectedSalesStage,
    };
  } catch {
    return null;
  }
}

function snapshotStillValid(
  customer: Customer,
  snapshot: ReturnType<typeof parsePriorityApprovalPayload>,
): boolean {
  if (!snapshot) return false;
  const currentPinned = customer.isPinned === 1;
  const currentSource = customer.pinnedSource ?? null;
  return (
    currentPinned === snapshot.expectedIsPinned &&
    currentSource === snapshot.expectedPinnedSource &&
    customer.salesStage === snapshot.expectedSalesStage
  );
}

export function assertPriorityApprovalCanExecute(
  approval: Approval,
  customer: Customer,
): void {
  if (
    !PRIORITY_REQUEST_TYPES.includes(
      approval.requestType as PriorityRequestType,
    )
  ) {
    throw new ApprovalError(400, "无效的申请类型");
  }

  const snapshot = parsePriorityApprovalPayload(approval);
  if (!snapshotStillValid(customer, snapshot)) {
    throw new ApprovalError(
      409,
      "客户优先状态已变更，无法继续处理此审批",
      PRIORITY_ERROR_CODES.STALE_PRIORITY_APPROVAL,
    );
  }

  if (approval.requestType === "unset_priority_customer") {
    if (shouldSkipUnsetPriorityMutation(customer)) {
      throw new ApprovalError(
        409,
        "客户优先状态已变更，无法继续处理此审批",
        PRIORITY_ERROR_CODES.STALE_PRIORITY_APPROVAL,
      );
    }
  }
}

export async function approvePriorityCustomerRequest(
  db: Database,
  approval: Approval,
  customer: Customer,
  reviewer: User,
  adminComment?: string | null,
): Promise<"updated" | "no_change"> {
  assertPriorityApprovalCanExecute(approval, customer);

  const now = new Date().toISOString();

  if (approval.requestType === "set_priority_customer") {
    if (shouldSkipSetPriorityMutation(customer)) {
      return "no_change";
    }
    const patch = buildApprovalSetPriorityFields(now);
    const previous = priorityAuditSnapshot(customer);
    await db
      .update(schema.customers)
      .set({
        ...patch,
        updatedBy: reviewer.id,
        updatedAt: now,
      })
      .where(eq(schema.customers.id, customer.id));

    await writeAuditLog(
      {
        userId: reviewer.id,
        action: APPROVAL_AUDIT_ACTIONS.priorityApprovedSet,
        entityType: "customer",
        entityId: customer.id,
        metadata: {
          approvalId: approval.id,
          requestedBy: approval.requestedBy,
          previous,
          next: priorityAuditSnapshot({ ...customer, ...patch }),
        },
      },
      db,
    );
    return "updated";
  }

  if (shouldSkipUnsetPriorityMutation(customer)) {
    throw new ApprovalError(
      409,
      "客户优先状态已变更，无法继续处理此审批",
      PRIORITY_ERROR_CODES.STALE_PRIORITY_APPROVAL,
    );
  }

  const patch = buildAdminRemovePriorityFields();
  const previous = priorityAuditSnapshot(customer);
  await db
    .update(schema.customers)
    .set({
      ...patch,
      updatedBy: reviewer.id,
      updatedAt: now,
    })
    .where(eq(schema.customers.id, customer.id));

  await writeAuditLog(
    {
      userId: reviewer.id,
      action: APPROVAL_AUDIT_ACTIONS.priorityApprovedUnset,
      entityType: "customer",
      entityId: customer.id,
      metadata: {
        approvalId: approval.id,
        requestedBy: approval.requestedBy,
        previous,
        next: priorityAuditSnapshot({ ...customer, ...patch }),
      },
    },
    db,
  );

  return "updated";
}

export async function writeAutomaticPriorityAudit(
  db: Database,
  params: {
    customerId: string;
    actorId: string;
    action:
      | typeof APPROVAL_AUDIT_ACTIONS.priorityAutoSetOnHold
      | typeof APPROVAL_AUDIT_ACTIONS.priorityAutoRemovedLeaveOnHold;
    previous: Record<string, unknown>;
    next: Record<string, unknown>;
  },
): Promise<void> {
  await writeAuditLog(
    {
      userId: params.actorId,
      action: params.action,
      entityType: "customer",
      entityId: params.customerId,
      metadata: {
        previous: params.previous,
        next: params.next,
      },
    },
    db,
  );
}

export { extractChanges as extractPriorityApprovalCasChanges };
