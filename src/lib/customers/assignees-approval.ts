import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { listCustomerAssignees } from "@/lib/customers/assignees";
import {
  assertValidCollaboratorAssignees,
  AssigneeMutationError,
  assertCustomerCollaboratorsMutable,
  applyCollaboratorAssignees,
} from "@/lib/customers/assignees-mutations";
import {
  diffCollaboratorUserIds,
  parseAssigneeUpdateApprovalPayload,
  validateAssigneeApprovalReason,
  validateCollaboratorUserIds,
  type AssigneeUpdateApprovalPayload,
} from "@/lib/customers/assignees-validation";
import {
  buildCustomerAssigneesAdminPayload,
  mapAssigneeMutationErrorToApiCode,
  type AssigneeStaffSummary,
} from "@/lib/customers/assignees-api";
import {
  assertCanRequestCustomerAssigneeUpdate,
  PermissionError,
} from "@/lib/permissions/customers";
import { findPendingApproval } from "@/lib/approvals/queries";
import { createNotification } from "@/lib/notifications/service";
import { listActiveAdminUsers } from "@/lib/users/queries";
import { APPROVAL_AUDIT_ACTIONS } from "@/lib/approvals/constants";
import { getUserById } from "@/lib/users/queries";

export type AssigneeApprovalError = {
  status: number;
  message: string;
  errorCode: string;
  fieldErrors?: { field: string; message: string; code?: string }[];
};

export type AssigneeApprovalRequestInput = {
  requestedCollaboratorIds?: unknown;
  reason?: unknown;
};

function toStaffNameSummaries(
  summaries: AssigneeStaffSummary[],
  ids: string[],
): Array<{ id: string; name: string }> {
  const byId = new Map(summaries.map((row) => [row.id, row.name]));
  return ids.map((id) => ({
    id,
    name: byId.get(id) ?? id,
  }));
}

export function mapAssigneeApprovalMutationError(
  error: AssigneeMutationError,
): AssigneeApprovalError {
  return {
    status: error.code === "CUSTOMER_NOT_FOUND" ? 404 : 400,
    message: error.message,
    errorCode: mapAssigneeMutationErrorToApiCode(error.code),
  };
}

export function toAssigneeApprovalPermissionError(
  error: unknown,
): AssigneeApprovalError | null {
  if (!(error instanceof PermissionError)) {
    return null;
  }

  if (error.auditAction === "permission.denied.pending_on_hold_create") {
    return {
      status: 403,
      message: error.message,
      errorCode: "PENDING_ON_HOLD_CREATE",
    };
  }

  if (error.auditAction === "customer.assignees.request_failed.archived") {
    return {
      status: error.status,
      message: error.message,
      errorCode: "ASSIGNEE_APPROVAL_FORBIDDEN",
    };
  }

  if (
    error.auditAction === "permission.denied.customer_assignees_request" ||
    error.auditAction === "permission.denied.customer_assignees_request_admin"
  ) {
    return {
      status: error.status,
      message: error.message,
      errorCode: "ASSIGNEE_APPROVAL_FORBIDDEN",
    };
  }

  return {
    status: error.status,
    message: error.message,
    errorCode: error.auditAction ?? "INSUFFICIENT_PERMISSIONS",
  };
}

export async function getCustomerAssigneesPreviewPayload(
  db: Database,
  user: User,
  customer: Customer,
) {
  if (user.role === "admin") {
    const { getCustomerAssigneesAdminPayload } = await import(
      "@/lib/customers/assignees-api"
    );
    return getCustomerAssigneesAdminPayload(db, user, customer);
  }

  assertCanRequestCustomerAssigneeUpdate(user, customer);
  await assertCustomerCollaboratorsMutable(db, customer.id);
  return buildCustomerAssigneesAdminPayload(db, customer);
}

async function notifyAdminsAssigneePending(
  db: Database,
  approvalId: string,
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
        approvalType: "update_customer_assignees",
      },
      relatedEntityType: "approval",
      relatedEntityId: approvalId,
    });
  }
}

export async function createCustomerAssigneeUpdateApprovalRequest(
  db: Database,
  customer: Customer,
  user: User,
  input: AssigneeApprovalRequestInput,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ id: string }> {
  assertCanRequestCustomerAssigneeUpdate(user, customer);
  await assertCustomerCollaboratorsMutable(db, customer.id);

  const reasonValidation = validateAssigneeApprovalReason(input.reason);
  if (!reasonValidation.ok) {
    throw {
      status: 400,
      message: "输入校验失败",
      errorCode: "VALIDATION_FAILED",
      fieldErrors: reasonValidation.errors,
    } satisfies AssigneeApprovalError;
  }

  const idsValidation = validateCollaboratorUserIds(input.requestedCollaboratorIds);
  if (!idsValidation.ok) {
    throw {
      status: 400,
      message: "输入校验失败",
      errorCode: "ASSIGNEE_INVALID_PAYLOAD",
      fieldErrors: idsValidation.errors,
    } satisfies AssigneeApprovalError;
  }

  const requestedCollaboratorIds = idsValidation.value;

  try {
    await assertValidCollaboratorAssignees(
      db,
      customer.id,
      requestedCollaboratorIds,
    );
  } catch (error) {
    if (error instanceof AssigneeMutationError) {
      throw mapAssigneeApprovalMutationError(error);
    }
    throw error;
  }

  const existing = await findPendingApproval(
    db,
    customer.id,
    "update_customer_assignees",
  );
  if (existing) {
    throw {
      status: 409,
      message: "已有共同负责员工调整申请正在审核中",
      errorCode: "ASSIGNEE_APPROVAL_ALREADY_PENDING",
    } satisfies AssigneeApprovalError;
  }

  const assignees = await listCustomerAssignees(db, customer.id);
  const currentCollaboratorIds = assignees
    .filter((row) => row.role === "collaborator")
    .map((row) => row.userId);

  const { addedUserIds, removedUserIds } = diffCollaboratorUserIds(
    currentCollaboratorIds,
    requestedCollaboratorIds,
  );

  const preview = await buildCustomerAssigneesAdminPayload(db, customer);
  const staffSummaries = [...preview.availableStaff, ...preview.collaborators];

  const payload: AssigneeUpdateApprovalPayload = {
    action: "set_collaborators",
    currentCollaboratorIds,
    requestedCollaboratorIds,
    addedUserIds,
    removedUserIds,
    reason: reasonValidation.value,
    currentCollaborators: toStaffNameSummaries(
      staffSummaries,
      currentCollaboratorIds,
    ),
    requestedCollaborators: toStaffNameSummaries(
      staffSummaries,
      requestedCollaboratorIds,
    ),
    addedCollaborators: toStaffNameSummaries(staffSummaries, addedUserIds),
    removedCollaborators: toStaffNameSummaries(staffSummaries, removedUserIds),
  };

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.insert(schema.approvals).values({
    id,
    requestType: "update_customer_assignees",
    status: "pending",
    customerId: customer.id,
    requestedBy: user.id,
    targetUserId: null,
    relatedCustomerIds: null,
    payload: JSON.stringify(payload),
    reason: reasonValidation.value,
    createdAt: now,
    updatedAt: now,
  });

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
      requestType: "update_customer_assignees",
      addedUserIds,
      removedUserIds,
    },
  });

  await notifyAdminsAssigneePending(db, id, customer);

  return { id };
}

export async function executeApprovedAssigneeUpdate(
  db: Database,
  approval: {
    id: string;
    payload: string | null;
    requestedBy: string;
  },
  customer: Customer,
  reviewer: User,
): Promise<void> {
  await assertCustomerCollaboratorsMutable(db, customer.id);

  let parsedPayload: unknown;
  try {
    parsedPayload = approval.payload ? JSON.parse(approval.payload) : null;
  } catch {
    throw Object.assign(new Error("ASSIGNEE_APPROVAL_INVALID_PAYLOAD"), {
      errorCode: "ASSIGNEE_APPROVAL_INVALID_PAYLOAD",
    });
  }

  const payload = parseAssigneeUpdateApprovalPayload(parsedPayload);
  if (!payload) {
    throw Object.assign(new Error("ASSIGNEE_APPROVAL_INVALID_PAYLOAD"), {
      errorCode: "ASSIGNEE_APPROVAL_INVALID_PAYLOAD",
    });
  }

  await applyCollaboratorAssignees(db, {
    customerId: customer.id,
    collaboratorUserIds: payload.requestedCollaboratorIds,
    assignedBy: reviewer.id,
  });

  const requester = await getUserById(approval.requestedBy);

  await writeAuditLog(
    {
      userId: reviewer.id,
      action: APPROVAL_AUDIT_ACTIONS.customerAssigneesUpdatedViaApproval,
      entityType: "customer",
      entityId: customer.id,
      metadata: {
        approvalId: approval.id,
        customerName: customer.customerName,
        requestedBy: approval.requestedBy,
        requestedByName: requester?.displayName ?? approval.requestedBy,
        previousCollaboratorIds: payload.currentCollaboratorIds ?? [],
        requestedCollaboratorIds: payload.requestedCollaboratorIds,
        addedUserIds: payload.addedUserIds ?? [],
        removedUserIds: payload.removedUserIds ?? [],
      },
    },
    db,
  );
}
