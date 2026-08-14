import { and, eq, sql } from "drizzle-orm";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import type { User } from "../../../../drizzle/schema/users";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import { extractChanges } from "@/lib/reclamation/auto-reclaim-cas";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import {
  inverseRelationshipForAudit,
  mapPlanToHouseholdAction,
  planFamilyLink,
  type FamilyLinkPlan,
} from "./link-plan";

export type FamilyLinkExecutionResult = {
  kind: FamilyLinkPlan["kind"];
  householdId: string | null;
};

type FamilyLinkAuditContext = {
  approvalId?: string;
  requestedBy?: string;
  reviewedBy?: string;
};

export type FamilyLinkApprovalCas = {
  approvalId: string;
  reviewerId: string;
  adminComment: string | null;
  now: string;
};

function mapPlanError(plan: FamilyLinkPlan): FamilyLinkError | null {
  switch (plan.kind) {
    case "household_conflict":
      return new FamilyLinkError(
        409,
        "该客户已属于另一个家庭组，目前不能直接关联",
        FAMILY_ERROR_CODES.HOUSEHOLD_CONFLICT,
      );
    case "relationship_conflict":
      return new FamilyLinkError(
        409,
        "两位客户已存在不同的家庭关系记录",
        FAMILY_ERROR_CODES.RELATIONSHIP_CONFLICT,
      );
    case "invalid_household_state":
      return new FamilyLinkError(
        409,
        "家庭组状态异常，请联系管理员处理",
        FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE,
      );
    default:
      return null;
  }
}

function approvalPendingGuardFrom(approvalId: string) {
  return sql`
    FROM approvals
    WHERE id = ${approvalId}
      AND status = 'pending'
  `;
}

function buildGuardedHouseholdInsert(
  db: Database,
  approvalId: string,
  values: {
    id: string;
    createdFromCustomerId: string;
    createdBy: string;
    now: string;
  },
) {
  return db.insert(schema.customerHouseholds).select(
    sql`
      SELECT
        ${values.id} AS id,
        'active' AS status,
        ${values.createdFromCustomerId} AS created_from_customer_id,
        NULL AS remark,
        ${values.createdBy} AS created_by,
        ${values.now} AS created_at,
        ${values.now} AS updated_at,
        NULL AS dissolved_at,
        NULL AS dissolved_by
      ${approvalPendingGuardFrom(approvalId)}
    `,
  );
}

function buildGuardedMemberInsert(
  db: Database,
  approvalId: string,
  values: {
    id: string;
    householdId: string;
    customerId: string;
    joinedBy: string;
    now: string;
  },
) {
  return db.insert(schema.customerHouseholdMembers).select(
    sql`
      SELECT
        ${values.id} AS id,
        ${values.householdId} AS household_id,
        ${values.customerId} AS customer_id,
        ${values.now} AS joined_at,
        ${values.joinedBy} AS joined_by,
        NULL AS left_at,
        NULL AS removed_by
      ${approvalPendingGuardFrom(approvalId)}
    `,
  );
}

function buildGuardedRelationshipInsert(
  db: Database,
  approvalId: string,
  values: {
    id: string;
    householdId: string;
    fromCustomerId: string;
    toCustomerId: string;
    relationshipType: HouseholdRelationshipType;
    createdBy: string;
    now: string;
  },
) {
  return db.insert(schema.customerHouseholdRelationships).select(
    sql`
      SELECT
        ${values.id} AS id,
        ${values.householdId} AS household_id,
        ${values.fromCustomerId} AS from_customer_id,
        ${values.toCustomerId} AS to_customer_id,
        ${values.relationshipType} AS relationship_type,
        NULL AS remark,
        ${values.createdBy} AS created_by,
        ${values.now} AS created_at,
        ${values.now} AS updated_at
      ${approvalPendingGuardFrom(approvalId)}
    `,
  );
}

export function buildFamilyLinkStatements(
  db: Database,
  params: {
    plan: FamilyLinkPlan;
    sourceId: string;
    targetId: string;
    relationshipType: HouseholdRelationshipType;
    actorId: string;
    now: string;
    approvalId?: string;
  },
) {
  const { plan, sourceId, targetId, relationshipType, actorId, now, approvalId } =
    params;
  const statements: unknown[] = [];
  const guarded = approvalId != null;

  let householdId: string | null = null;

  const insertHousehold = (
    id: string,
    createdFromCustomerId: string,
  ) => {
    if (guarded) {
      statements.push(
        buildGuardedHouseholdInsert(db, approvalId, {
          id,
          createdFromCustomerId,
          createdBy: actorId,
          now,
        }),
      );
    } else {
      statements.push(
        db.insert(schema.customerHouseholds).values({
          id,
          status: "active",
          createdFromCustomerId,
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  };

  const insertMember = (id: string, hhId: string, customerId: string) => {
    if (guarded) {
      statements.push(
        buildGuardedMemberInsert(db, approvalId, {
          id,
          householdId: hhId,
          customerId,
          joinedBy: actorId,
          now,
        }),
      );
    } else {
      statements.push(
        db.insert(schema.customerHouseholdMembers).values({
          id,
          householdId: hhId,
          customerId,
          joinedAt: now,
          joinedBy: actorId,
        }),
      );
    }
  };

  const insertRelationship = (id: string, hhId: string) => {
    if (guarded) {
      statements.push(
        buildGuardedRelationshipInsert(db, approvalId, {
          id,
          householdId: hhId,
          fromCustomerId: sourceId,
          toCustomerId: targetId,
          relationshipType,
          createdBy: actorId,
          now,
        }),
      );
    } else {
      statements.push(
        db.insert(schema.customerHouseholdRelationships).values({
          id,
          householdId: hhId,
          fromCustomerId: sourceId,
          toCustomerId: targetId,
          relationshipType,
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  };

  if (plan.kind === "create_household") {
    householdId = crypto.randomUUID();
    insertHousehold(householdId, sourceId);
    insertMember(crypto.randomUUID(), householdId, sourceId);
    insertMember(crypto.randomUUID(), householdId, targetId);
    insertRelationship(crypto.randomUUID(), householdId);
  } else if (
    plan.kind === "add_target_to_source_household" ||
    plan.kind === "add_source_to_target_household" ||
    plan.kind === "relation_only"
  ) {
    householdId = plan.householdId;

    if (plan.kind === "add_target_to_source_household") {
      insertMember(crypto.randomUUID(), householdId, targetId);
    }

    if (plan.kind === "add_source_to_target_household") {
      insertMember(crypto.randomUUID(), householdId, sourceId);
    }

    insertRelationship(crypto.randomUUID(), householdId);
  } else if (plan.kind === "already_linked") {
    householdId = plan.householdId;
  } else {
    throw mapPlanError(plan);
  }

  return { statements, householdId };
}

export async function writeFamilyLinkAudit(
  db: Database,
  params: {
    source: Customer;
    target: Customer;
    relationshipType: HouseholdRelationshipType;
    householdId: string | null;
    householdAction: string;
    actor: User;
    auditContext?: FamilyLinkAuditContext;
  },
): Promise<void> {
  const { source, target, relationshipType, householdId, householdAction, actor, auditContext } =
    params;

  const baseMetadata = {
    otherCustomerId: target.id,
    relationshipType,
    householdAction,
    householdId,
    ...(auditContext?.approvalId
      ? {
          approvalId: auditContext.approvalId,
          requestedBy: auditContext.requestedBy,
          reviewedBy: auditContext.reviewedBy,
        }
      : {}),
  };

  await writeAuditLog(
    {
      userId: actor.id,
      action: auditContext?.approvalId
        ? "customer.family_link_approved"
        : "customer.family_linked",
      entityType: "customer",
      entityId: source.id,
      metadata: baseMetadata,
    },
    db,
  );

  await writeAuditLog(
    {
      userId: actor.id,
      action: auditContext?.approvalId
        ? "customer.family_link_approved"
        : "customer.family_linked",
      entityType: "customer",
      entityId: target.id,
      metadata: {
        ...baseMetadata,
        otherCustomerId: source.id,
        relationshipType: inverseRelationshipForAudit(relationshipType),
      },
    },
    db,
  );
}

function mapBatchUniqueConstraintError(error: unknown): FamilyLinkError | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/UNIQUE constraint failed/i.test(message)) {
    return null;
  }
  if (/customer_household_members/i.test(message)) {
    return new FamilyLinkError(
      409,
      "家庭成员状态冲突",
      FAMILY_ERROR_CODES.HOUSEHOLD_CONFLICT,
    );
  }
  if (/customer_household_relationships/i.test(message)) {
    return new FamilyLinkError(
      409,
      "该客户已是家庭成员",
      FAMILY_ERROR_CODES.LINK_ALREADY_EXISTS,
    );
  }
  return null;
}

export async function executeFamilyLink(
  db: Database,
  params: {
    source: Customer;
    target: Customer;
    relationshipType: HouseholdRelationshipType;
    actor: User;
    auditContext?: FamilyLinkAuditContext;
    approvalCas?: FamilyLinkApprovalCas;
  },
): Promise<FamilyLinkExecutionResult> {
  if (params.source.id === params.target.id) {
    throw new FamilyLinkError(
      400,
      "不能将客户关联到自身",
      FAMILY_ERROR_CODES.SELF_LINK_NOT_ALLOWED,
    );
  }

  const plan = await planFamilyLink(
    db,
    params.source.id,
    params.target.id,
    params.relationshipType,
  );

  const planError = mapPlanError(plan);
  if (planError) {
    throw planError;
  }

  const now = params.approvalCas?.now ?? new Date().toISOString();
  const { statements, householdId } = buildFamilyLinkStatements(db, {
    plan,
    sourceId: params.source.id,
    targetId: params.target.id,
    relationshipType: params.relationshipType,
    actorId: params.actor.id,
    now,
    approvalId: params.approvalCas?.approvalId,
  });

  if (params.approvalCas) {
    statements.push(
      buildApprovalPendingToApprovedStatement(
        db,
        params.approvalCas.approvalId,
        params.approvalCas.reviewerId,
        params.approvalCas.adminComment,
        now,
      ),
    );
  }

  if (statements.length > 0) {
    try {
      const batchResults = (await db.batch(
        statements as unknown as Parameters<Database["batch"]>[0],
      )) as readonly unknown[];

      if (params.approvalCas) {
        const casResult = batchResults[batchResults.length - 1];
        const changes = extractChanges(casResult);
        if (changes !== 1) {
          throw new FamilyLinkError(
            409,
            "该申请已处理，不能重复审批",
            FAMILY_ERROR_CODES.APPROVAL_ALREADY_PROCESSED,
          );
        }
      }
    } catch (error) {
      if (error instanceof FamilyLinkError) {
        throw error;
      }
      const uniqueError = mapBatchUniqueConstraintError(error);
      if (uniqueError) {
        throw uniqueError;
      }
      throw error;
    }
  }

  if (plan.kind !== "already_linked") {
    await writeFamilyLinkAudit(db, {
      source: params.source,
      target: params.target,
      relationshipType: params.relationshipType,
      householdId,
      householdAction: mapPlanToHouseholdAction(plan),
      actor: params.actor,
      auditContext: params.auditContext,
    });
  }

  return { kind: plan.kind, householdId };
}

export async function loadCustomerById(
  db: Database,
  customerId: string,
): Promise<Customer | null> {
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function assertCustomersExist(
  db: Database,
  sourceId: string,
  targetId: string,
): Promise<{ source: Customer; target: Customer }> {
  const [source, target] = await Promise.all([
    loadCustomerById(db, sourceId),
    loadCustomerById(db, targetId),
  ]);

  if (!source) {
    throw new FamilyLinkError(
      404,
      "源客户不存在",
      FAMILY_ERROR_CODES.SOURCE_NOT_ELIGIBLE,
    );
  }

  if (!target) {
    throw new FamilyLinkError(
      404,
      "目标客户不存在",
      FAMILY_ERROR_CODES.TARGET_NOT_FOUND,
    );
  }

  return { source, target };
}

export function buildApprovalPendingToApprovedStatement(
  db: Database,
  approvalId: string,
  reviewerId: string,
  adminComment: string | null,
  now: string,
) {
  return db
    .update(schema.approvals)
    .set({
      status: "approved",
      adminComment,
      reviewedBy: reviewerId,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.approvals.id, approvalId),
        eq(schema.approvals.status, "pending"),
      ),
    );
}
