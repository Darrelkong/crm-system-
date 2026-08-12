import { and, eq } from "drizzle-orm";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import type { User } from "../../../../drizzle/schema/users";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
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

function buildFamilyLinkStatements(
  db: Database,
  params: {
    plan: FamilyLinkPlan;
    sourceId: string;
    targetId: string;
    relationshipType: HouseholdRelationshipType;
    actorId: string;
    now: string;
  },
) {
  const { plan, sourceId, targetId, relationshipType, actorId, now } = params;
  const statements: unknown[] = [];

  let householdId: string | null = null;

  if (plan.kind === "create_household") {
    householdId = crypto.randomUUID();
    statements.push(
      db.insert(schema.customerHouseholds).values({
        id: householdId,
        status: "active",
        createdFromCustomerId: sourceId,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(schema.customerHouseholdMembers).values({
        id: crypto.randomUUID(),
        householdId,
        customerId: sourceId,
        joinedAt: now,
        joinedBy: actorId,
      }),
      db.insert(schema.customerHouseholdMembers).values({
        id: crypto.randomUUID(),
        householdId,
        customerId: targetId,
        joinedAt: now,
        joinedBy: actorId,
      }),
      db.insert(schema.customerHouseholdRelationships).values({
        id: crypto.randomUUID(),
        householdId,
        fromCustomerId: sourceId,
        toCustomerId: targetId,
        relationshipType,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      }),
    );
  } else if (
    plan.kind === "add_target_to_source_household" ||
    plan.kind === "add_source_to_target_household" ||
    plan.kind === "relation_only"
  ) {
    householdId = plan.householdId;

    if (plan.kind === "add_target_to_source_household") {
      statements.push(
        db.insert(schema.customerHouseholdMembers).values({
          id: crypto.randomUUID(),
          householdId,
          customerId: targetId,
          joinedAt: now,
          joinedBy: actorId,
        }),
      );
    }

    if (plan.kind === "add_source_to_target_household") {
      statements.push(
        db.insert(schema.customerHouseholdMembers).values({
          id: crypto.randomUUID(),
          householdId,
          customerId: sourceId,
          joinedAt: now,
          joinedBy: actorId,
        }),
      );
    }

    statements.push(
      db.insert(schema.customerHouseholdRelationships).values({
        id: crypto.randomUUID(),
        householdId,
        fromCustomerId: sourceId,
        toCustomerId: targetId,
        relationshipType,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      }),
    );
  } else if (plan.kind === "already_linked") {
    householdId = plan.householdId;
  } else {
    throw mapPlanError(plan);
  }

  return { statements, householdId };
}

async function writeFamilyLinkAudit(
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

export async function executeFamilyLink(
  db: Database,
  params: {
    source: Customer;
    target: Customer;
    relationshipType: HouseholdRelationshipType;
    actor: User;
    auditContext?: FamilyLinkAuditContext;
    approvalUpdateStatement?: unknown;
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

  const now = new Date().toISOString();
  const { statements, householdId } = buildFamilyLinkStatements(db, {
    plan,
    sourceId: params.source.id,
    targetId: params.target.id,
    relationshipType: params.relationshipType,
    actorId: params.actor.id,
    now,
  });

  if (params.approvalUpdateStatement) {
    statements.push(params.approvalUpdateStatement);
  }

  if (statements.length > 0) {
    try {
      await db.batch(
        statements as unknown as Parameters<Database["batch"]>[0],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed/i.test(message)) {
        if (/customer_household_members/i.test(message)) {
          throw new FamilyLinkError(
            409,
            "家庭成员状态冲突",
            FAMILY_ERROR_CODES.HOUSEHOLD_CONFLICT,
          );
        }
        if (/customer_household_relationships/i.test(message)) {
          throw new FamilyLinkError(
            409,
            "该客户已是家庭成员",
            FAMILY_ERROR_CODES.LINK_ALREADY_EXISTS,
          );
        }
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
