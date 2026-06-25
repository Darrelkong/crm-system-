import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { writeFieldChangeLogEntry } from "@/lib/customers/field-change-log";
import { createNotification } from "@/lib/notifications/service";
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
import { findPendingApproval, getApprovalById } from "./queries";
import type { ApprovalRequestInput } from "./validation";
import { validateApprovalRequestInput } from "./validation";

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

async function notifyAdminsPending(
  db: Database,
  approval: Approval,
  customer: Customer,
): Promise<void> {
  const admins = await listActiveAdminUsers();

  for (const admin of admins) {
    await createNotification(db, {
      userId: admin.id,
      type: "approval.pending",
      titleKey: "notificationTypes.approval_pending",
      messageKey: "notificationMessages.approvalPendingAdmin",
      messageParams: {
        customerName: customer.customerName,
        approvalType: approval.requestType,
      },
      relatedEntityType: "approval",
      relatedEntityId: approval.id,
    });
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
  await createNotification(db, {
    userId: approval.requestedBy,
    type,
    titleKey,
    messageKey,
    messageParams,
    relatedEntityType: "approval",
    relatedEntityId: approval.id,
  });
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
      await db
        .update(schema.customers)
        .set({
          status: "archived",
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
          action: APPROVAL_AUDIT_ACTIONS.customerDeletedSoft,
          entityType: "customer",
          entityId: customer.id,
          metadata: {
            approvalId: approval.id,
            customerName: customer.customerName,
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

      await db
        .update(schema.customers)
        .set({
          ownerId: approval.targetUserId,
          updatedBy: reviewer.id,
          updatedAt: now,
          ...(transferredFromPublicPool
            ? {
                status: "active" as const,
                poolLeftAt: now,
                claimedBy: approval.targetUserId,
                claimedAt: now,
              }
            : {}),
        })
        .where(eq(schema.customers.id, customer.id));

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
          messageParams: { customerName: customer.customerName },
          relatedEntityType: "customer",
          relatedEntityId: customer.id,
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
        messageParams: { customerName: customer.customerName },
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
        messageParams: { customerName: customer.customerName },
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
  }
}

export async function createApprovalRequest(
  customer: Customer,
  user: User,
  input: ApprovalRequestInput,
  audit?: AuditMeta,
): Promise<{ id: string }> {
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

  await db
    .update(schema.approvals)
    .set({
      status: "approved",
      adminComment: adminComment?.trim() || null,
      reviewedBy: reviewer.id,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.approvals.id, approvalId));

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

  await db
    .update(schema.approvals)
    .set({
      status: "rejected",
      adminComment: adminComment?.trim() || null,
      reviewedBy: reviewer.id,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.approvals.id, approvalId));

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
