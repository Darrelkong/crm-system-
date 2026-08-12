import { and, eq } from "drizzle-orm";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import type { User } from "../../../../drizzle/schema/users";
import { APPROVAL_AUDIT_ACTIONS } from "@/lib/approvals/constants";
import { ApprovalError } from "@/lib/approvals/service";
import { isArchivedCustomer } from "@/lib/customers/archived";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import { createNotificationOnce } from "@/lib/notifications/service";
import { customerNameNotificationParams } from "@/lib/notifications/customer-name";
import { listActiveAdminUsers } from "@/lib/users/queries";
import { logApprovalNotificationFailure } from "@/lib/approvals/notification-safe";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import {
  assertCanManageCustomerFamily,
  assertFamilyTargetEligible,
  resolveFamilyLinkMode,
} from "./family-permissions";
import type { ProtectedLookup } from "./family-candidates";
import {
  resolveProtectedExactLookup,
  resolveTargetFromProtectedLookup,
  resolveTargetFromVisibleId,
} from "./family-candidates";
import {
  buildApprovalPendingToApprovedStatement,
  executeFamilyLink,
  loadCustomerById,
} from "./link-existing";
import {
  isValidHouseholdRelationshipType,
  planFamilyLink,
} from "./link-plan";

const FAMILY_LINK_REASON = "Family customer link request";

export type FamilyLinkRequestBody = {
  relationshipType?: unknown;
  targetCustomerId?: unknown;
  protectedLookup?: unknown;
};

function parseProtectedLookup(value: unknown): ProtectedLookup {
  if (!value || typeof value !== "object") {
    throw new FamilyLinkError(400, "无效的保护客户查询", FAMILY_ERROR_CODES.TARGET_NOT_FOUND);
  }

  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const rawValue = record.value;

  if (
    kind !== "customerCode" &&
    kind !== "phone" &&
    kind !== "wechatId" &&
    kind !== "email"
  ) {
    throw new FamilyLinkError(400, "无效的保护客户查询", FAMILY_ERROR_CODES.TARGET_NOT_FOUND);
  }

  if (typeof rawValue !== "string" || !rawValue.trim()) {
    throw new FamilyLinkError(400, "无效的保护客户查询", FAMILY_ERROR_CODES.TARGET_NOT_FOUND);
  }

  return { kind, value: rawValue.trim() };
}

function parseRelationshipType(value: unknown): HouseholdRelationshipType {
  if (typeof value !== "string" || !isValidHouseholdRelationshipType(value)) {
    throw new FamilyLinkError(
      400,
      "无效的家庭关系",
      FAMILY_ERROR_CODES.INVALID_RELATIONSHIP,
    );
  }
  return value;
}

function parseJsonArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

export async function findPendingFamilyLinkPair(
  db: Database,
  sourceId: string,
  targetId: string,
) {
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.requestType, "link_family_customer"),
        eq(schema.approvals.status, "pending"),
      ),
    );

  return (
    rows.find((row) => {
      const related = parseJsonArray(row.relatedCustomerIds);
      const relatedId = related?.[0];
      if (!relatedId) return false;
      return (
        (row.customerId === sourceId && relatedId === targetId) ||
        (row.customerId === targetId && relatedId === sourceId)
      );
    }) ?? null
  );
}

async function notifyAdminsFamilyPending(
  db: Database,
  approvalId: string,
  customer: Customer,
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
          approvalType: "link_family_customer",
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

async function revalidateFamilyLinkEligibility(
  db: Database,
  source: Customer,
  target: Customer,
  relationshipType: HouseholdRelationshipType,
): Promise<void> {
  if (
    source.customerType !== "individual" ||
    source.deletedAt ||
    isArchivedCustomer(source)
  ) {
    throw new FamilyLinkError(
      400,
      "当前客户无法管理家庭成员",
      FAMILY_ERROR_CODES.SOURCE_NOT_ELIGIBLE,
    );
  }

  assertFamilyTargetEligible(target);

  if (source.id === target.id) {
    throw new FamilyLinkError(
      400,
      "不能将客户关联到自身",
      FAMILY_ERROR_CODES.SELF_LINK_NOT_ALLOWED,
    );
  }

  const plan = await planFamilyLink(db, source.id, target.id, relationshipType);
  if (
    plan.kind === "household_conflict" ||
    plan.kind === "relationship_conflict" ||
    plan.kind === "invalid_household_state"
  ) {
    const code =
      plan.kind === "household_conflict"
        ? FAMILY_ERROR_CODES.HOUSEHOLD_CONFLICT
        : plan.kind === "relationship_conflict"
          ? FAMILY_ERROR_CODES.RELATIONSHIP_CONFLICT
          : FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE;
    throw new FamilyLinkError(409, "家庭关联当前无法完成", code);
  }
}

export async function createFamilyLinkApprovalRequest(
  db: Database,
  source: Customer,
  user: User,
  target: Customer,
  relationshipType: HouseholdRelationshipType,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ id: string }> {
  assertCanManageCustomerFamily(user, source);
  assertFamilyTargetEligible(target);

  if (source.id === target.id) {
    throw new FamilyLinkError(
      400,
      "不能将客户关联到自身",
      FAMILY_ERROR_CODES.SELF_LINK_NOT_ALLOWED,
    );
  }

  const plan = await planFamilyLink(db, source.id, target.id, relationshipType);
  if (plan.kind === "already_linked") {
    throw new FamilyLinkError(
      409,
      "该客户已是家庭成员",
      FAMILY_ERROR_CODES.LINK_ALREADY_EXISTS,
    );
  }
  if (
    plan.kind === "household_conflict" ||
    plan.kind === "relationship_conflict" ||
    plan.kind === "invalid_household_state"
  ) {
    const code =
      plan.kind === "household_conflict"
        ? FAMILY_ERROR_CODES.HOUSEHOLD_CONFLICT
        : plan.kind === "relationship_conflict"
          ? FAMILY_ERROR_CODES.RELATIONSHIP_CONFLICT
          : FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE;
    throw new FamilyLinkError(409, "家庭关联当前无法完成", code);
  }

  const existing = await findPendingFamilyLinkPair(db, source.id, target.id);
  if (existing) {
    throw new FamilyLinkError(
      409,
      "该家庭关联申请已在审批中",
      FAMILY_ERROR_CODES.DUPLICATE_PENDING,
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.insert(schema.approvals).values({
    id,
    requestType: "link_family_customer",
    status: "pending",
    customerId: source.id,
    requestedBy: user.id,
    targetUserId: null,
    relatedCustomerIds: JSON.stringify([target.id]),
    payload: JSON.stringify({ relationshipType }),
    reason: FAMILY_LINK_REASON,
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
      customerId: source.id,
      customerName: source.customerName,
      requestType: "link_family_customer",
    },
  });

  await notifyAdminsFamilyPending(db, id, source);

  return { id };
}

export async function submitFamilyLinkRequest(
  db: Database,
  source: Customer,
  user: User,
  body: FamilyLinkRequestBody,
  audit?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<
  | { mode: "direct"; kind: string }
  | { mode: "approval"; approvalId: string }
> {
  assertCanManageCustomerFamily(user, source);

  const relationshipType = parseRelationshipType(body.relationshipType);
  const hasTargetId =
    typeof body.targetCustomerId === "string" && body.targetCustomerId.trim();
  const hasProtected = body.protectedLookup != null;

  if ((hasTargetId && hasProtected) || (!hasTargetId && !hasProtected)) {
    throw new FamilyLinkError(
      400,
      "请提供唯一的目标客户",
      FAMILY_ERROR_CODES.TARGET_NOT_FOUND,
    );
  }

  let target: Customer;
  if (hasProtected) {
    const lookup = parseProtectedLookup(body.protectedLookup);
    target = await resolveTargetFromProtectedLookup(db, source.id, lookup);
  } else {
    target = await resolveTargetFromVisibleId(
      db,
      user,
      source.id,
      String(body.targetCustomerId).trim(),
    );
  }

  assertFamilyTargetEligible(target);

  if (source.id === target.id) {
    throw new FamilyLinkError(
      400,
      "不能将客户关联到自身",
      FAMILY_ERROR_CODES.SELF_LINK_NOT_ALLOWED,
    );
  }

  const isAssignee =
    user.role === "staff"
      ? (
          await db
            .select({ id: schema.customerAssignees.id })
            .from(schema.customerAssignees)
            .where(
              and(
                eq(schema.customerAssignees.customerId, target.id),
                eq(schema.customerAssignees.userId, user.id),
              ),
            )
            .limit(1)
        ).length > 0
      : false;

  const linkMode = resolveFamilyLinkMode(user, target, isAssignee);

  if (linkMode === "direct") {
    const result = await executeFamilyLink(db, {
      source,
      target,
      relationshipType,
      actor: user,
    });
    return { mode: "direct", kind: result.kind };
  }

  const approval = await createFamilyLinkApprovalRequest(
    db,
    source,
    user,
    target,
    relationshipType,
    audit,
  );
  return { mode: "approval", approvalId: approval.id };
}

export async function approveFamilyLinkApprovalRequest(
  db: Database,
  approval: {
    id: string;
    customerId: string;
    requestedBy: string;
    relatedCustomerIds: string | null;
    payload: string | null;
    status: string;
  },
  reviewer: User,
  adminComment?: string,
): Promise<void> {
  if (approval.status !== "pending") {
    throw new ApprovalError(409, "该申请已处理，不能重复审批");
  }

  const related = parseJsonArray(approval.relatedCustomerIds);
  const targetId = related?.[0];
  if (!targetId) {
    throw new ApprovalError(400, "家庭关联申请数据无效");
  }

  let payload: { relationshipType?: string };
  try {
    payload = approval.payload ? JSON.parse(approval.payload) : {};
  } catch {
    throw new ApprovalError(400, "家庭关联申请数据无效");
  }

  const relationshipType = parseRelationshipType(payload.relationshipType);

  const source = await loadCustomerById(db, approval.customerId);
  const target = await loadCustomerById(db, targetId);
  if (!source || !target) {
    throw new ApprovalError(404, "关联客户不存在");
  }

  try {
    await revalidateFamilyLinkEligibility(db, source, target, relationshipType);
  } catch (error) {
    if (error instanceof FamilyLinkError) {
      throw new ApprovalError(error.status, error.message, error.errorCode);
    }
    throw error;
  }

  const now = new Date().toISOString();
  const approvalUpdate = buildApprovalPendingToApprovedStatement(
    db,
    approval.id,
    reviewer.id,
    adminComment?.trim() || null,
    now,
  );

  try {
    await executeFamilyLink(db, {
      source,
      target,
      relationshipType,
      actor: reviewer,
      auditContext: {
        approvalId: approval.id,
        requestedBy: approval.requestedBy,
        reviewedBy: reviewer.id,
      },
      approvalUpdateStatement: approvalUpdate,
    });
  } catch (error) {
    if (error instanceof FamilyLinkError) {
      throw new ApprovalError(error.status, error.message, error.errorCode);
    }
    throw error;
  }
}

export async function resolveProtectedLookupForSubmission(
  db: Database,
  user: User,
  sourceId: string,
  lookup: ProtectedLookup,
): Promise<Customer> {
  const masked = await resolveProtectedExactLookup(db, user, sourceId, lookup);
  if (!masked) {
    throw new FamilyLinkError(
      404,
      "目标客户不存在",
      FAMILY_ERROR_CODES.TARGET_NOT_FOUND,
    );
  }
  return resolveTargetFromProtectedLookup(db, sourceId, lookup);
}
