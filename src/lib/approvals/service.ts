import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { writeFieldChangeLogEntry } from "@/lib/customers/field-change-log";
import {
  createNotification,
  createNotificationOnce,
} from "@/lib/notifications/service";
import { customerNameNotificationParams } from "@/lib/notifications/customer-name";
import { logApprovalNotificationFailure, markApprovalPendingNotificationsReadSafely } from "./notification-safe";
import type { Approval } from "../../../drizzle/schema/approvals";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import {
  getUserById,
  listActiveAdminUsers,
} from "@/lib/users/queries";
import {
  APPROVAL_AUDIT_ACTIONS,
} from "./constants";
import {
  MERGE_CUSTOMERS_DISABLED_CODE,
  MERGE_CUSTOMERS_DISABLED_MESSAGE,
  isDisabledMergeCustomersRequestType,
} from "./errors";
import { findPendingApproval, getApprovalById } from "./queries";
import type { ApprovalRequestInput } from "./validation";
import { validateApprovalRequestInput } from "./validation";
import { getReclamationCycleStartedAt } from "@/lib/reclamation/cycle";
import {
  expireReclamationActionItems,
  RECLAMATION_EXPIRE_REASON,
} from "@/lib/reclamation/work-items-sync";
import {
  TASK_CANCEL_REASON,
  buildCancelOpenTasksForCustomerStatement,
  buildTaskCancelAuditFields,
} from "@/lib/tasks/lifecycle";
import {
  buildOnHoldCreateApprovedAuditMetadata,
  buildOnHoldCreateApprovedCustomerUpdate,
  buildOnHoldCreateRejectedAuditMetadata,
  resolveOnHoldReasonFromApproval,
} from "@/lib/customers/pending-on-hold-access";
import {
  executeApprovedAssigneeUpdate,
} from "@/lib/customers/assignees-approval";
import { approveFamilyLinkApprovalRequest } from "@/lib/customers/households/family-link-approval";
import { buildTransferPrimaryAssigneeStatements } from "@/lib/customers/transfer-primary-assignee";
import {
  AssigneeMutationError,
} from "@/lib/customers/assignees-mutations";
import { mapAssigneeMutationErrorToApiCode } from "@/lib/customers/assignees-api";

type AuditMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export class ApprovalError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApprovalError";
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

async function notifyAdminsPending(
  db: Database,
  approval: Approval,
  customer: Customer,
): Promise<void> {
  let recipientIds: string[];
  try {
    const admins = await listActiveAdminUsers();
    recipientIds = [...new Set(admins.map((admin) => admin.id))];
  } catch (error) {
    logApprovalNotificationFailure({
      approvalId: approval.id,
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
          approvalType: approval.requestType,
        },
        relatedEntityType: "approval",
        relatedEntityId: approval.id,
      });
    } catch (error) {
      logApprovalNotificationFailure({
        approvalId: approval.id,
        recipientUserId,
        notificationType: "approval.pending",
        error,
      });
    }
  }
}

async function notifyApplicant(
  db: Database,
  approval: Approval,
  type: "approval.approved" | "approval.rejected",
  titleKey: string,
  messageKey: string,
  messageParams: Record<string, string>,
): Promise<void> {
  try {
    await createNotificationOnce(db, {
      userId: approval.requestedBy,
      type,
      titleKey,
      messageKey,
      messageParams,
      relatedEntityType: "approval",
      relatedEntityId: approval.id,
    });
  } catch (error) {
    logApprovalNotificationFailure({
      approvalId: approval.id,
      recipientUserId: approval.requestedBy,
      notificationType: type,
      error,
    });
  }
}

async function reassignOpenTasks(
  db: Database,
  customerId: string,
  fromUserId: string,
  toUserId: string,
  now: string,
): Promise<number> {
  const openTasks = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.customerId, customerId),
        eq(schema.tasks.assignedTo, fromUserId),
        eq(schema.tasks.status, "open"),
      ),
    );

  for (const task of openTasks) {
    await db
      .update(schema.tasks)
      .set({ assignedTo: toUserId, updatedAt: now })
      .where(eq(schema.tasks.id, task.id));
  }

  return openTasks.length;
}

async function executeApprovedAction(
  db: Database,
  approval: Approval,
  customer: Customer,
  reviewer: User,
): Promise<void> {
  const now = new Date().toISOString();

  switch (approval.requestType) {
    case "delete_customer": {
      await db.batch([
        db
          .update(schema.customers)
          .set({
            status: "archived",
            deletedAt: now,
            deletedBy: reviewer.id,
            deletedReason: approval.reason ?? null,
            updatedBy: reviewer.id,
            updatedAt: now,
          })
          .where(eq(schema.customers.id, customer.id)),
        buildCancelOpenTasksForCustomerStatement(db, customer.id, now),
      ] as unknown as Parameters<Database["batch"]>[0]);

      await writeFieldChangeLogEntry(
        customer.id,
        "status",
        customer.status,
        "archived",
        reviewer.id,
      );

      await writeAuditLog(
        {
          userId: reviewer.id,
          action: APPROVAL_AUDIT_ACTIONS.customerDeletedSoft,
          entityType: "customer",
          entityId: customer.id,
          metadata: {
            approvalId: approval.id,
            customerName: customer.customerName,
            deletedAt: now,
            deletedReason: approval.reason ?? null,
            ...buildTaskCancelAuditFields(TASK_CANCEL_REASON.softArchive),
          },
        },
        db,
      );
      break;
    }

    case "transfer_customer": {
      if (!approval.targetUserId) {
        throw new ApprovalError(400, "转移申请缺少目标员工");
      }

      const previousOwnerId = customer.ownerId;
      const transferredFromPublicPool = customer.status === "public_pool";
      const targetUserId = approval.targetUserId;
      const previousCycleStartedAt = getReclamationCycleStartedAt(customer);

      const updateCustomerStmt = db
        .update(schema.customers)
        .set({
          ownerId: targetUserId,
          updatedBy: reviewer.id,
          updatedAt: now,
          reclamationCycleStartedAt: now,
          reclaimRuleGraceUntil: null,
          ...(transferredFromPublicPool
            ? {
                status: "active" as const,
                poolLeftAt: now,
                claimedBy: targetUserId,
                claimedAt: now,
              }
            : {}),
        })
        .where(eq(schema.customers.id, customer.id));

      // Owner ⇔ primary assignee must be synced atomically: the customer owner
      // update and the primary reassignment share one db.batch so a partial
      // failure can never leave ownerId and the primary row inconsistent.
      const primaryAssigneeStmts = buildTransferPrimaryAssigneeStatements(db, {
        customerId: customer.id,
        targetUserId,
        assignedBy: reviewer.id,
        now,
      });

      await db.batch(
        [updateCustomerStmt, ...primaryAssigneeStmts] as unknown as Parameters<
          Database["batch"]
        >[0],
      );

      await writeFieldChangeLogEntry(
        customer.id,
        "owner_id",
        previousOwnerId,
        approval.targetUserId,
        reviewer.id,
      );

      if (transferredFromPublicPool) {
        await writeFieldChangeLogEntry(
          customer.id,
          "status",
          customer.status,
          "active",
          reviewer.id,
        );
      }

      if (previousOwnerId) {
        const reassignedCount = await reassignOpenTasks(
          db,
          customer.id,
          previousOwnerId,
          approval.targetUserId,
          now,
        );

        await writeAuditLog(
          {
            userId: reviewer.id,
            action: APPROVAL_AUDIT_ACTIONS.customerTransferred,
            entityType: "customer",
            entityId: customer.id,
            metadata: {
              approvalId: approval.id,
              customerName: customer.customerName,
              previousOwnerId,
              newOwnerId: approval.targetUserId,
              reassignedTaskCount: reassignedCount,
              transferredFromPublicPool,
            },
          },
          db,
        );

        await createNotification(db, {
          userId: previousOwnerId,
          type: "customer.transferred",
          titleKey: "notificationTypes.customer_transferred",
          messageKey: "notificationMessages.customerTransferredAway",
          messageParams: customerNameNotificationParams(customer),
          relatedEntityType: "customer",
          relatedEntityId: customer.id,
        });

        await expireReclamationActionItems(db, {
          customerId: customer.id,
          userId: previousOwnerId,
          cycleStartedAt: previousCycleStartedAt,
          reason: RECLAMATION_EXPIRE_REASON.transferred,
        });
      } else if (transferredFromPublicPool) {
        await writeAuditLog(
          {
            userId: reviewer.id,
            action: APPROVAL_AUDIT_ACTIONS.customerTransferred,
            entityType: "customer",
            entityId: customer.id,
            metadata: {
              approvalId: approval.id,
              customerName: customer.customerName,
              previousOwnerId,
              newOwnerId: approval.targetUserId,
              reassignedTaskCount: 0,
              transferredFromPublicPool: true,
            },
          },
          db,
        );
      }

      await createNotification(db, {
        userId: approval.targetUserId,
        type: "customer.transferred",
        titleKey: "notificationTypes.customer_transferred",
        messageKey: "notificationMessages.customerTransferredToYou",
        messageParams: customerNameNotificationParams(customer),
        relatedEntityType: "customer",
        relatedEntityId: customer.id,
      });
      break;
    }

    case "merge_customers": {
      await writeAuditLog(
        {
          userId: reviewer.id,
          action: APPROVAL_AUDIT_ACTIONS.mergeApprovedPlaceholder,
          entityType: "approval",
          entityId: approval.id,
          metadata: {
            customerId: customer.id,
            customerName: customer.customerName,
            relatedCustomerIds: approval.relatedCustomerIds,
            note: "Phase 8 placeholder — no field merge executed",
          },
        },
        db,
      );
      break;
    }

    case "closed_won": {
      await db
        .update(schema.customers)
        .set({
          salesStage: "closed_won",
          updatedBy: reviewer.id,
          updatedAt: now,
        })
        .where(eq(schema.customers.id, customer.id));

      await writeFieldChangeLogEntry(
        customer.id,
        "sales_stage",
        customer.salesStage,
        "closed_won",
        reviewer.id,
      );

      await writeAuditLog(
        {
          userId: reviewer.id,
          action: APPROVAL_AUDIT_ACTIONS.customerClosedWonApproved,
          entityType: "customer",
          entityId: customer.id,
          metadata: {
            approvalId: approval.id,
            customerName: customer.customerName,
            payload: approval.payload,
          },
        },
        db,
      );

      await createNotification(db, {
        userId: approval.requestedBy,
        type: "customer.closed_won.approved",
        titleKey: "notificationTypes.customer_closed_won_approved",
        messageKey: "notificationMessages.closedWonApproved",
        messageParams: customerNameNotificationParams(customer),
        relatedEntityType: "customer",
        relatedEntityId: customer.id,
      });
      break;
    }

    case "second_conversion": {
      await writeAuditLog(
        {
          userId: reviewer.id,
          action: APPROVAL_AUDIT_ACTIONS.secondConversionApproved,
          entityType: "approval",
          entityId: approval.id,
          metadata: {
            customerId: customer.id,
            customerName: customer.customerName,
            payload: approval.payload,
          },
        },
        db,
      );
      break;
    }

    case "create_on_hold_customer": {
      const onHoldReason = resolveOnHoldReasonFromApproval(approval);
      const requester = await getUserById(approval.requestedBy);
      const approvedUpdate = buildOnHoldCreateApprovedCustomerUpdate(now);

      await db
        .update(schema.customers)
        .set({
          ...approvedUpdate,
          updatedBy: reviewer.id,
        })
        .where(eq(schema.customers.id, customer.id));

      await writeFieldChangeLogEntry(
        customer.id,
        "sales_stage",
        customer.salesStage,
        "on_hold",
        reviewer.id,
      );

      await writeAuditLog(
        {
          userId: reviewer.id,
          action: APPROVAL_AUDIT_ACTIONS.customerOnHoldCreateApproved,
          entityType: "customer",
          entityId: customer.id,
          metadata: buildOnHoldCreateApprovedAuditMetadata({
            approvalId: approval.id,
            customerName: customer.customerName,
            requestedBy: approval.requestedBy,
            requestedByName: requester?.displayName ?? approval.requestedBy,
            onHoldReason,
          }),
        },
        db,
      );
      break;
    }

    case "paid_customer": {
      await db
        .update(schema.customers)
        .set({
          salesStage: "paid",
          updatedBy: reviewer.id,
          updatedAt: now,
        })
        .where(eq(schema.customers.id, customer.id));

      await writeFieldChangeLogEntry(
        customer.id,
        "sales_stage",
        customer.salesStage,
        "paid",
        reviewer.id,
      );

      await writeAuditLog(
        {
          userId: reviewer.id,
          action: APPROVAL_AUDIT_ACTIONS.customerPaidApproved,
          entityType: "customer",
          entityId: customer.id,
          metadata: {
            approvalId: approval.id,
            customerName: customer.customerName,
            payload: approval.payload,
          },
        },
        db,
      );
      break;
    }

    case "update_customer_assignees": {
      try {
        await executeApprovedAssigneeUpdate(
          db,
          {
            id: approval.id,
            payload: approval.payload,
            requestedBy: approval.requestedBy,
          },
          customer,
          reviewer,
        );
      } catch (error) {
        if (error instanceof AssigneeMutationError) {
          throw new ApprovalError(
            400,
            error.message,
            mapAssigneeMutationErrorToApiCode(error.code),
          );
        }
        if (
          error &&
          typeof error === "object" &&
          "errorCode" in error &&
          (error as { errorCode: string }).errorCode ===
            "ASSIGNEE_APPROVAL_INVALID_PAYLOAD"
        ) {
          throw new ApprovalError(
            400,
            "共同负责员工调整申请数据无效",
            "ASSIGNEE_APPROVAL_INVALID_PAYLOAD",
          );
        }
        throw error;
      }
      break;
    }
  }
}

async function executeRejectedAction(
  db: Database,
  approval: Approval,
  customer: Customer,
  reviewer: User,
  adminComment?: string,
): Promise<void> {
  if (approval.requestType !== "create_on_hold_customer") {
    return;
  }

  const now = new Date().toISOString();
  const rejectReason =
    adminComment?.trim() ||
    approval.reason?.trim() ||
    "create_on_hold_customer rejected";

  await db
    .update(schema.customers)
    .set({
      status: "archived",
      deletedAt: now,
      deletedBy: reviewer.id,
      deletedReason: rejectReason,
      updatedBy: reviewer.id,
      updatedAt: now,
    })
    .where(eq(schema.customers.id, customer.id));

  await writeFieldChangeLogEntry(
    customer.id,
    "status",
    customer.status,
    "archived",
    reviewer.id,
  );

  await writeAuditLog(
    {
      userId: reviewer.id,
      action: APPROVAL_AUDIT_ACTIONS.customerOnHoldCreateRejected,
      entityType: "customer",
      entityId: customer.id,
      metadata: buildOnHoldCreateRejectedAuditMetadata({
        approvalId: approval.id,
        customerName: customer.customerName,
        requestedBy: approval.requestedBy,
        adminComment,
      }),
    },
    db,
  );
}

export async function createApprovalRequest(
  customer: Customer,
  user: User,
  input: ApprovalRequestInput,
  audit?: AuditMeta,
): Promise<{ id: string }> {
  if (isDisabledMergeCustomersRequestType(input.requestType ?? "")) {
    throw new ApprovalError(
      403,
      MERGE_CUSTOMERS_DISABLED_MESSAGE,
      MERGE_CUSTOMERS_DISABLED_CODE,
    );
  }

  const db = getDb();
  const validation = validateApprovalRequestInput(input);

  if (!validation.ok) {
    await writeAuditLog({
      userId: user.id,
      action: APPROVAL_AUDIT_ACTIONS.requestFailedValidation,
      entityType: "customer",
      entityId: customer.id,
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
      metadata: { fieldErrors: validation.fieldErrors },
    });
    throw Object.assign(
      new ApprovalError(400, "输入校验失败", "validation"),
      { fieldErrors: validation.fieldErrors },
    );
  }

  const value = validation.value;

  if (value.requestType === "transfer_customer" && value.targetUserId) {
    const targetUser = await getUserById(value.targetUserId);
    if (!targetUser || targetUser.role !== "staff" || targetUser.isActive !== 1) {
      await writeAuditLog({
        userId: user.id,
        action: APPROVAL_AUDIT_ACTIONS.requestFailedValidation,
        entityType: "customer",
        entityId: customer.id,
        ipAddress: audit?.ipAddress,
        userAgent: audit?.userAgent,
        metadata: { field: "targetUserId", message: "目标员工无效" },
      });
      throw new ApprovalError(400, "目标员工无效");
    }

    if (value.targetUserId === customer.ownerId) {
      throw new ApprovalError(400, "目标员工不能与当前负责人相同");
    }
  }

  const existing = await findPendingApproval(
    db,
    customer.id,
    value.requestType,
  );
  if (existing) {
    throw new ApprovalError(
      409,
      "该客户已有相同类型的待审批申请",
      "duplicate_pending",
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.insert(schema.approvals).values({
    id,
    requestType: value.requestType,
    status: "pending",
    customerId: customer.id,
    requestedBy: user.id,
    targetUserId: value.targetUserId ?? null,
    relatedCustomerIds: value.relatedCustomerIds
      ? JSON.stringify(value.relatedCustomerIds)
      : null,
    payload: value.payload ? JSON.stringify(value.payload) : null,
    reason: value.reason,
    createdAt: now,
    updatedAt: now,
  });

  const approval = (await getApprovalById(db, id))!;

  await writeAuditLog({
    userId: user.id,
    action: APPROVAL_AUDIT_ACTIONS.requested,
    entityType: "approval",
    entityId: id,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
    metadata: {
      customerId: customer.id,
      customerName: customer.customerName,
      requestType: value.requestType,
    },
  });

  await notifyAdminsPending(db, approval, customer);

  return { id };
}

export async function approveApprovalRequest(
  approvalId: string,
  reviewer: User,
  adminComment?: string,
  audit?: AuditMeta,
): Promise<void> {
  const db = getDb();
  const approval = await getApprovalById(db, approvalId);

  if (!approval) {
    throw new ApprovalError(404, "申请不存在");
  }

  if (approval.status !== "pending") {
    throw new ApprovalError(409, "该申请已处理，不能重复审批");
  }

  if (isDisabledMergeCustomersRequestType(approval.requestType)) {
    throw new ApprovalError(
      403,
      MERGE_CUSTOMERS_DISABLED_MESSAGE,
      MERGE_CUSTOMERS_DISABLED_CODE,
    );
  }

  const customerRows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, approval.customerId))
    .limit(1);
  const customer = customerRows[0];
  if (!customer) {
    throw new ApprovalError(404, "关联客户不存在");
  }

  if (approval.requestType === "link_family_customer") {
    await approveFamilyLinkApprovalRequest(
      db,
      approval,
      reviewer,
      adminComment,
    );

    await writeAuditLog({
      userId: reviewer.id,
      action: APPROVAL_AUDIT_ACTIONS.approved,
      entityType: "approval",
      entityId: approvalId,
      ipAddress: audit?.ipAddress,
      userAgent: audit?.userAgent,
      metadata: {
        requestType: approval.requestType,
        customerId: approval.customerId,
        requestedBy: approval.requestedBy,
      },
    });

    await markApprovalPendingNotificationsReadSafely(
      db,
      approvalId,
      "approved",
    );

    const comment = adminComment?.trim();
    await notifyApplicant(
      db,
      approval,
      "approval.approved",
      "notificationTypes.approval_approved",
      comment
        ? "notificationMessages.approvalApprovedWithComment"
        : "notificationMessages.approvalApproved",
      {
        approvalType: approval.requestType,
        adminComment: comment ?? "",
      },
    );
    return;
  }

  const now = new Date().toISOString();

  const updateResult = await db
    .update(schema.approvals)
    .set({
      status: "approved",
      adminComment: adminComment?.trim() || null,
      reviewedBy: reviewer.id,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.approvals.id, approvalId),
        eq(schema.approvals.status, "pending"),
      ),
    );

  const changes = extractChanges(updateResult);
  if (changes === 0) {
    throw new ApprovalError(409, "该申请已处理，不能重复审批");
  }
  if (changes !== null && changes !== 1) {
    throw new ApprovalError(409, "该申请已处理，不能重复审批");
  }

  await executeApprovedAction(db, approval, customer, reviewer);

  await writeAuditLog({
    userId: reviewer.id,
    action: APPROVAL_AUDIT_ACTIONS.approved,
    entityType: "approval",
    entityId: approvalId,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
    metadata: {
      requestType: approval.requestType,
      customerId: approval.customerId,
      requestedBy: approval.requestedBy,
    },
  });

  await markApprovalPendingNotificationsReadSafely(
    db,
    approvalId,
    "approved",
  );

  const comment = adminComment?.trim();
  await notifyApplicant(
    db,
    approval,
    "approval.approved",
    "notificationTypes.approval_approved",
    comment
      ? "notificationMessages.approvalApprovedWithComment"
      : "notificationMessages.approvalApproved",
    {
      approvalType: approval.requestType,
      adminComment: comment ?? "",
    },
  );
}

export async function rejectApprovalRequest(
  approvalId: string,
  reviewer: User,
  adminComment?: string,
  audit?: AuditMeta,
): Promise<void> {
  const db = getDb();
  const approval = await getApprovalById(db, approvalId);

  if (!approval) {
    throw new ApprovalError(404, "申请不存在");
  }

  if (approval.status !== "pending") {
    throw new ApprovalError(409, "该申请已处理，不能重复审批");
  }

  const customerRows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, approval.customerId))
    .limit(1);
  const customer = customerRows[0];
  if (!customer) {
    throw new ApprovalError(404, "关联客户不存在");
  }

  const now = new Date().toISOString();

  const updateResult = await db
    .update(schema.approvals)
    .set({
      status: "rejected",
      adminComment: adminComment?.trim() || null,
      reviewedBy: reviewer.id,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.approvals.id, approvalId),
        eq(schema.approvals.status, "pending"),
      ),
    );

  const changes = extractChanges(updateResult);
  if (changes === 0) {
    throw new ApprovalError(409, "该申请已处理，不能重复审批");
  }
  if (changes !== null && changes !== 1) {
    throw new ApprovalError(409, "该申请已处理，不能重复审批");
  }

  await executeRejectedAction(db, approval, customer, reviewer, adminComment);

  await writeAuditLog({
    userId: reviewer.id,
    action: APPROVAL_AUDIT_ACTIONS.rejected,
    entityType: "approval",
    entityId: approvalId,
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
    metadata: {
      requestType: approval.requestType,
      customerId: approval.customerId,
      requestedBy: approval.requestedBy,
    },
  });

  await markApprovalPendingNotificationsReadSafely(
    db,
    approvalId,
    "rejected",
  );

  const comment = adminComment?.trim();
  await notifyApplicant(
    db,
    approval,
    "approval.rejected",
    "notificationTypes.approval_rejected",
    comment
      ? "notificationMessages.approvalRejectedWithComment"
      : "notificationMessages.approvalRejected",
    {
      approvalType: approval.requestType,
      adminComment: comment ?? "",
    },
  );
}

export function approvalErrorResponse(error: unknown): Response {
  if (error instanceof ApprovalError) {
    const errorCode =
      error.code ??
      (error.message === "申请不存在"
        ? "APPROVAL_NOT_FOUND"
        : error.message === "该申请已处理，不能重复审批"
          ? "APPROVAL_ALREADY_PROCESSED"
          : error.message === "输入校验失败"
            ? "VALIDATION_FAILED"
            : undefined);
    return Response.json(
      { error: error.message, code: error.code, errorCode },
      { status: error.status },
    );
  }
  return Response.json(
    { error: "服务器错误", errorCode: "SERVER_ERROR" },
    { status: 500 },
  );
}
