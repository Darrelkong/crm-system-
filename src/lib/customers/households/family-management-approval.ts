import { and, eq, or, sql } from "drizzle-orm";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import type { User } from "../../../../drizzle/schema/users";
import { APPROVAL_AUDIT_ACTIONS } from "@/lib/approvals/constants";
import { ApprovalError } from "@/lib/approvals/service";
import { getApprovalById } from "@/lib/approvals/queries";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import { createNotificationOnce } from "@/lib/notifications/service";
import { customerNameNotificationParams } from "@/lib/notifications/customer-name";
import { listActiveAdminUsers } from "@/lib/users/queries";
import { logApprovalNotificationFailure } from "@/lib/approvals/notification-safe";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import {
  assertCanManageExistingFamilySource,
  resolveExistingFamilyManagementMode,
} from "./family-permissions";
import {
  buildPendingFamilyManagementPairNotExistsSql,
  type RelationshipApprovalSnapshot,
  type UnlinkApprovalSnapshot,
} from "./family-management-cas";
import {
  buildRelationshipSnapshot,
  buildUnlinkSnapshot,
  loadFamilyManagementContext,
} from "./family-management-context";
import {
  executeRelationshipUpdate,
  parseRelationshipTypeInput,
} from "./family-relationship-update";
import { executeFamilyUnlink } from "./family-unlink";
import { loadCustomerById } from "./link-existing";

const RELATIONSHIP_UPDATE_REASON = "Family relationship update request";
const UNLINK_REASON = "Family unlink request";

const FAMILY_MANAGEMENT_REQUEST_TYPES = [
  "update_family_relationship",
  "unlink_family_customer",
] as const;

function parseJsonArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

async function isTargetAssignee(
  db: Database,
  userId: string,
  targetId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.customerAssignees.id })
    .from(schema.customerAssignees)
    .where(
      and(
        eq(schema.customerAssignees.customerId, targetId),
        eq(schema.customerAssignees.userId, userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function findPendingFamilyManagementPair(
  db: Database,
  sourceId: string,
  targetId: string,
) {
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(
      and(
        sql`${schema.approvals.requestType} IN ('update_family_relationship', 'unlink_family_customer')`,
        eq(schema.approvals.status, "pending"),
        or(
          and(
            eq(schema.approvals.customerId, sourceId),
            sql`json_extract(${schema.approvals.relatedCustomerIds}, '$[0]') = ${targetId}`,
          ),
          and(
            eq(schema.approvals.customerId, targetId),
            sql`json_extract(${schema.approvals.relatedCustomerIds}, '$[0]') = ${sourceId}`,
          ),
        ),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function notifyAdminsFamilyManagementPending(
  db: Database,
  approvalId: string,
  customer: Customer,
  requestType: (typeof FAMILY_MANAGEMENT_REQUEST_TYPES)[number],
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

async function createFamilyManagementApproval(
  db: Database,
  params: {
    source: Customer;
    user: User;
    target: Customer;
    requestType: (typeof FAMILY_MANAGEMENT_REQUEST_TYPES)[number];
    payload: Record<string, unknown>;
    reason: string;
    audit?: { ipAddress?: string | null; userAgent?: string | null };
  },
): Promise<{ id: string }> {
  const existing = await findPendingFamilyManagementPair(
    db,
    params.source.id,
    params.target.id,
  );
  if (existing) {
    throw new FamilyLinkError(
      409,
      "该家庭管理申请已在审批中",
      FAMILY_ERROR_CODES.DUPLICATE_PENDING,
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const relatedCustomerIdsJson = JSON.stringify([params.target.id]);
  const payloadJson = JSON.stringify(params.payload);

  await db.insert(schema.approvals).select(
    sql`
      SELECT
        ${id} AS id,
        ${params.requestType} AS request_type,
        ${"pending"} AS status,
        ${params.source.id} AS customer_id,
        ${params.user.id} AS requested_by,
        NULL AS target_user_id,
        ${relatedCustomerIdsJson} AS related_customer_ids,
        ${payloadJson} AS payload,
        ${params.reason} AS reason,
        NULL AS admin_comment,
        NULL AS reviewed_by,
        NULL AS reviewed_at,
        ${now} AS created_at,
        ${now} AS updated_at
      WHERE ${buildPendingFamilyManagementPairNotExistsSql(
        params.source.id,
        params.target.id,
      )}
    `,
  );

  const inserted = await getApprovalById(db, id);
  if (!inserted) {
    const racedDuplicate = await findPendingFamilyManagementPair(
      db,
      params.source.id,
      params.target.id,
    );
    if (racedDuplicate) {
      throw new FamilyLinkError(
        409,
        "该家庭管理申请已在审批中",
        FAMILY_ERROR_CODES.DUPLICATE_PENDING,
      );
    }
    throw new FamilyLinkError(
      409,
      "该家庭管理申请已在审批中",
      FAMILY_ERROR_CODES.DUPLICATE_PENDING,
    );
  }

  await writeAuditLog({
    userId: params.user.id,
    action: APPROVAL_AUDIT_ACTIONS.requested,
    entityType: "approval",
    entityId: id,
    ipAddress: params.audit?.ipAddress,
    userAgent: params.audit?.userAgent,
    metadata: {
      customerId: params.source.id,
      customerName: params.source.customerName,
      requestType: params.requestType,
    },
  });

  await notifyAdminsFamilyManagementPending(
    db,
    id,
    params.source,
    params.requestType,
  );

  return { id };
}

export async function submitFamilyRelationshipUpdate(
  db: Database,
  source: Customer,
  user: User,
  targetId: string,
  relationshipTypeInput: unknown,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<
  | { mode: "direct"; kind: "updated" | "no_change" }
  | { mode: "approval"; approvalId: string }
> {
  assertCanManageExistingFamilySource(user, source);
  const relationshipType = parseRelationshipTypeInput(relationshipTypeInput);

  const target = await loadCustomerById(db, targetId);
  if (!target) {
    throw new FamilyLinkError(
      404,
      "目标客户不存在",
      FAMILY_ERROR_CODES.TARGET_NOT_FOUND,
    );
  }

  const context = await loadFamilyManagementContext(db, source.id, targetId);
  const isAssignee = user.role === "staff" ? await isTargetAssignee(db, user.id, targetId) : false;
  const mode = resolveExistingFamilyManagementMode(user, target, isAssignee);

  if (mode === "direct") {
    const result = await executeRelationshipUpdate(db, {
      sourceId: source.id,
      targetId,
      relationshipType,
      actor: user,
    });
    return { mode: "direct", kind: result.kind };
  }

  const relationshipSnapshot = buildRelationshipSnapshot(context);
  const approval = await createFamilyManagementApproval(db, {
    source,
    user,
    target,
    requestType: "update_family_relationship",
    reason: RELATIONSHIP_UPDATE_REASON,
    payload: {
      householdId: context.householdId,
      requestedRelationshipType: relationshipType,
      ...relationshipSnapshot,
      sourceId: source.id,
      targetId,
    },
    audit,
  });
  return { mode: "approval", approvalId: approval.id };
}

export async function submitFamilyUnlink(
  db: Database,
  source: Customer,
  user: User,
  targetId: string,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<
  | { mode: "direct"; householdAction: "member_removed" | "household_dissolved" }
  | { mode: "approval"; approvalId: string }
> {
  assertCanManageExistingFamilySource(user, source);

  const target = await loadCustomerById(db, targetId);
  if (!target) {
    throw new FamilyLinkError(
      404,
      "目标客户不存在",
      FAMILY_ERROR_CODES.TARGET_NOT_FOUND,
    );
  }

  const context = await loadFamilyManagementContext(db, source.id, targetId);
  const isAssignee = user.role === "staff" ? await isTargetAssignee(db, user.id, targetId) : false;
  const mode = resolveExistingFamilyManagementMode(user, target, isAssignee);

  if (mode === "direct") {
    const result = await executeFamilyUnlink(db, {
      sourceId: source.id,
      targetId,
      actor: user,
    });
    return { mode: "direct", householdAction: result.householdAction };
  }

  const unlinkSnapshot = buildUnlinkSnapshot(context);
  const approval = await createFamilyManagementApproval(db, {
    source,
    user,
    target,
    requestType: "unlink_family_customer",
    reason: UNLINK_REASON,
    payload: {
      ...unlinkSnapshot,
      sourceId: source.id,
      targetId,
    },
    audit,
  });
  return { mode: "approval", approvalId: approval.id };
}

function parseRelationshipApprovalPayload(
  payload: string | null,
): RelationshipApprovalSnapshot & { requestedRelationshipType: HouseholdRelationshipType } {
  let parsed: Record<string, unknown>;
  try {
    parsed = payload ? (JSON.parse(payload) as Record<string, unknown>) : {};
  } catch {
    throw new ApprovalError(400, "家庭管理申请数据无效");
  }

  const relationshipType = parseRelationshipTypeInput(
    parsed.requestedRelationshipType,
  );

  if (
    typeof parsed.householdId !== "string" ||
    typeof parsed.sourceId !== "string" ||
    typeof parsed.targetId !== "string" ||
    typeof parsed.expectedRelationshipState !== "string"
  ) {
    throw new ApprovalError(400, "家庭管理申请数据无效");
  }

  return {
    householdId: parsed.householdId,
    sourceId: parsed.sourceId,
    targetId: parsed.targetId,
    requestedRelationshipType: relationshipType,
    expectedRelationshipState: parsed.expectedRelationshipState as RelationshipApprovalSnapshot["expectedRelationshipState"],
    expectedRelationshipRowId:
      typeof parsed.expectedRelationshipRowId === "string"
        ? parsed.expectedRelationshipRowId
        : null,
    expectedRelationshipType:
      typeof parsed.expectedRelationshipType === "string"
        ? (parsed.expectedRelationshipType as HouseholdRelationshipType)
        : null,
    expectedRelationshipUpdatedAt:
      typeof parsed.expectedRelationshipUpdatedAt === "string"
        ? parsed.expectedRelationshipUpdatedAt
        : null,
  };
}

function parseUnlinkApprovalPayload(payload: string | null): UnlinkApprovalSnapshot {
  let parsed: Record<string, unknown>;
  try {
    parsed = payload ? (JSON.parse(payload) as Record<string, unknown>) : {};
  } catch {
    throw new ApprovalError(400, "家庭管理申请数据无效");
  }

  if (
    typeof parsed.householdId !== "string" ||
    typeof parsed.sourceId !== "string" ||
    typeof parsed.targetId !== "string" ||
    typeof parsed.targetMembershipId !== "string" ||
    typeof parsed.targetMembershipJoinedAt !== "string" ||
    typeof parsed.expectedActiveMemberCount !== "number"
  ) {
    throw new ApprovalError(400, "家庭管理申请数据无效");
  }

  return {
    householdId: parsed.householdId,
    sourceId: parsed.sourceId,
    targetId: parsed.targetId,
    targetMembershipId: parsed.targetMembershipId,
    targetMembershipJoinedAt: parsed.targetMembershipJoinedAt,
    expectedActiveMemberCount: parsed.expectedActiveMemberCount,
  };
}

export async function approveFamilyRelationshipUpdateRequest(
  db: Database,
  approvalInput: { id: string; status: string; payload: string | null },
  reviewer: User,
  adminComment?: string,
): Promise<void> {
  const approval = await getApprovalById(db, approvalInput.id);
  if (!approval) {
    throw new ApprovalError(404, "审批申请不存在");
  }

  if (approval.status !== "pending") {
    throw new ApprovalError(409, "该申请已处理，不能重复审批");
  }

  const snapshot = parseRelationshipApprovalPayload(approval.payload);
  const now = new Date().toISOString();

  try {
    await executeRelationshipUpdate(db, {
      sourceId: snapshot.sourceId,
      targetId: snapshot.targetId,
      relationshipType: snapshot.requestedRelationshipType,
      actor: reviewer,
      auditContext: {
        approvalId: approval.id,
        requestedBy: approval.requestedBy,
        reviewedBy: reviewer.id,
      },
      approvalCas: {
        approvalId: approval.id,
        reviewerId: reviewer.id,
        adminComment: adminComment?.trim() || null,
        now,
      },
      snapshot,
    });
  } catch (error) {
    if (error instanceof FamilyLinkError) {
      throw new ApprovalError(error.status, error.message, error.errorCode);
    }
    throw error;
  }
}

export async function approveFamilyUnlinkRequest(
  db: Database,
  approvalInput: { id: string; status: string; payload: string | null },
  reviewer: User,
  adminComment?: string,
): Promise<void> {
  const approval = await getApprovalById(db, approvalInput.id);
  if (!approval) {
    throw new ApprovalError(404, "审批申请不存在");
  }

  if (approval.status !== "pending") {
    throw new ApprovalError(409, "该申请已处理，不能重复审批");
  }

  const snapshot = parseUnlinkApprovalPayload(approval.payload);
  const now = new Date().toISOString();

  try {
    await executeFamilyUnlink(db, {
      sourceId: snapshot.sourceId,
      targetId: snapshot.targetId,
      actor: reviewer,
      auditContext: {
        approvalId: approval.id,
        requestedBy: approval.requestedBy,
        reviewedBy: reviewer.id,
      },
      approvalCas: {
        approvalId: approval.id,
        reviewerId: reviewer.id,
        adminComment: adminComment?.trim() || null,
        now,
      },
      snapshot,
    });
  } catch (error) {
    if (error instanceof FamilyLinkError) {
      throw new ApprovalError(error.status, error.message, error.errorCode);
    }
    throw error;
  }
}

export async function approveFamilyManagementRequest(
  db: Database,
  approval: {
    id: string;
    requestType: string;
    status: string;
    payload: string | null;
    relatedCustomerIds: string | null;
    customerId: string;
    requestedBy: string;
  },
  reviewer: User,
  adminComment?: string,
): Promise<void> {
  if (approval.requestType === "update_family_relationship") {
    await approveFamilyRelationshipUpdateRequest(
      db,
      approval,
      reviewer,
      adminComment,
    );
    return;
  }

  if (approval.requestType === "unlink_family_customer") {
    await approveFamilyUnlinkRequest(db, approval, reviewer, adminComment);
    return;
  }

  throw new ApprovalError(400, "无效的家庭管理申请类型");
}

export { parseJsonArray };
