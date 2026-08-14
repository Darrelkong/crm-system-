import { and, eq, sql } from "drizzle-orm";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import type { User } from "../../../../drizzle/schema/users";
import { schema, type Database } from "@/lib/db";
import { extractChanges } from "@/lib/reclamation/auto-reclaim-cas";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import {
  buildRelationshipSnapshot,
  loadFamilyManagementContext,
  type FamilyManagementContext,
  type RelationshipOrientation,
} from "./family-management-context";
import { writeFamilyRelationshipUpdatedAudit } from "./family-management-audit";
import {
  isValidHouseholdRelationshipType,
  relationshipMatchesSubmittedPerspective,
} from "./link-plan";
import {
  buildFamilyManagementApprovalCas,
  type RelationshipApprovalSnapshot,
} from "./family-management-cas";

export type RelationshipUpdateResult =
  | { kind: "updated" }
  | { kind: "no_change" };

type RelationshipUpdateAuditContext = {
  approvalId?: string;
  requestedBy?: string;
  reviewedBy?: string;
};

function approvalApprovedGuardFrom(approvalId: string) {
  return sql`
    FROM approvals
    WHERE id = ${approvalId}
      AND status = 'approved'
  `;
}

function buildRelationshipUpdateStatements(
  db: Database,
  context: FamilyManagementContext,
  relationshipType: HouseholdRelationshipType,
  actorId: string,
  now: string,
  approvalId?: string,
): unknown[] {
  const { source, target, householdId, directRelationship, reverseRelationship } =
    context;
  const statements: unknown[] = [];
  const guarded = approvalId != null;

  if (reverseRelationship) {
    if (guarded) {
      statements.push(
        db.delete(schema.customerHouseholdRelationships).where(
          and(
            eq(schema.customerHouseholdRelationships.id, reverseRelationship.id),
            sql`EXISTS (
              SELECT 1 FROM approvals
              WHERE id = ${approvalId}
                AND status = 'approved'
            )`,
          ),
        ),
      );
    } else {
      statements.push(
        db
          .delete(schema.customerHouseholdRelationships)
          .where(eq(schema.customerHouseholdRelationships.id, reverseRelationship.id)),
      );
    }
  }

  if (directRelationship) {
    if (guarded) {
      statements.push(
        db
          .update(schema.customerHouseholdRelationships)
          .set({
            relationshipType,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.customerHouseholdRelationships.id, directRelationship.id),
              sql`EXISTS (
                SELECT 1 FROM approvals
                WHERE id = ${approvalId}
                  AND status = 'approved'
              )`,
            ),
          ),
      );
    } else {
      statements.push(
        db
          .update(schema.customerHouseholdRelationships)
          .set({
            relationshipType,
            updatedAt: now,
          })
          .where(eq(schema.customerHouseholdRelationships.id, directRelationship.id)),
      );
    }
  } else {
    const relationshipId = crypto.randomUUID();
    if (guarded) {
      statements.push(
        db.insert(schema.customerHouseholdRelationships).select(
          sql`
            SELECT
              ${relationshipId} AS id,
              ${householdId} AS household_id,
              ${source.id} AS from_customer_id,
              ${target.id} AS to_customer_id,
              ${relationshipType} AS relationship_type,
              NULL AS remark,
              ${actorId} AS created_by,
              ${now} AS created_at,
              ${now} AS updated_at
            ${approvalApprovedGuardFrom(approvalId!)}
          `,
        ),
      );
    } else {
      statements.push(
        db.insert(schema.customerHouseholdRelationships).values({
          id: relationshipId,
          householdId,
          fromCustomerId: source.id,
          toCustomerId: target.id,
          relationshipType,
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
  }

  return statements;
}

function assertRelationshipUpdateAllowed(
  context: FamilyManagementContext,
  relationshipType: HouseholdRelationshipType,
): RelationshipUpdateResult | null {
  if (context.relationshipOrientation === "invalid_both_directions") {
    throw new FamilyLinkError(
      409,
      "家庭关系状态异常，请联系管理员处理",
      FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE,
    );
  }

  if (context.target.customerType === "company") {
    throw new FamilyLinkError(
      400,
      "公司客户不能设置家庭关系，请解除家庭关联",
      FAMILY_ERROR_CODES.COMPANY_MEMBER_EDIT_FORBIDDEN,
    );
  }

  const match = relationshipMatchesSubmittedPerspective(
    relationshipType,
    context.directRelationship?.relationshipType ?? null,
    context.reverseRelationship?.relationshipType ?? null,
  );

  if (match === "match") {
    if (context.relationshipOrientation === "reverse") {
      return null;
    }
    return { kind: "no_change" };
  }

  if (match === "conflict" && context.relationshipOrientation !== "none") {
    // Allow explicit normalization from reverse to direct with new type.
    return null;
  }

  return null;
}

export async function executeRelationshipUpdate(
  db: Database,
  params: {
    sourceId: string;
    targetId: string;
    relationshipType: HouseholdRelationshipType;
    actor: User;
    auditContext?: RelationshipUpdateAuditContext;
    approvalCas?: {
      approvalId: string;
      reviewerId: string;
      adminComment: string | null;
      now: string;
    };
    snapshot?: RelationshipApprovalSnapshot;
    testAppendStatements?: (ctx: { db: Database }) => unknown[];
  },
): Promise<RelationshipUpdateResult> {
  const context = await loadFamilyManagementContext(
    db,
    params.sourceId,
    params.targetId,
  );

  const noChange = assertRelationshipUpdateAllowed(context, params.relationshipType);
  if (noChange) {
    return noChange;
  }

  const now = params.approvalCas?.now ?? new Date().toISOString();
  const previousOrientation = context.relationshipOrientation;
  const previousRelationship = context.currentPerspectiveRelationship;

  const statements = buildRelationshipUpdateStatements(
    db,
    context,
    params.relationshipType,
    params.actor.id,
    now,
    params.approvalCas?.approvalId,
  );

  if (params.approvalCas) {
    statements.unshift(
      buildFamilyManagementApprovalCas(db, {
        approvalId: params.approvalCas.approvalId,
        reviewerId: params.approvalCas.reviewerId,
        adminComment: params.approvalCas.adminComment,
        now,
        relationshipSnapshot: params.snapshot,
      }),
    );
  }

  if (params.testAppendStatements) {
    statements.push(...params.testAppendStatements({ db }));
  }

  if (statements.length > 0) {
    const batchResults = (await db.batch(
      statements as unknown as Parameters<Database["batch"]>[0],
    )) as readonly unknown[];

    if (params.approvalCas) {
      const casResult = batchResults[0];
      const changes = extractChanges(casResult);
      if (changes !== 1) {
        throw new FamilyLinkError(
          409,
          "家庭审批状态已变更，无法继续处理",
          FAMILY_ERROR_CODES.APPROVAL_STALE,
        );
      }
    }
  }

  await writeFamilyRelationshipUpdatedAudit(db, {
    source: context.source,
    target: context.target,
    householdId: context.householdId,
    previousRelationship,
    newRelationship: params.relationshipType,
    relationshipOrientationNormalized:
      previousOrientation === "none" ? "none" : previousOrientation,
    actor: params.actor,
    auditContext: params.auditContext,
  });

  return { kind: "updated" };
}

export function parseRelationshipTypeInput(
  value: unknown,
): HouseholdRelationshipType {
  if (typeof value !== "string" || !isValidHouseholdRelationshipType(value)) {
    throw new FamilyLinkError(
      400,
      "无效的家庭关系",
      FAMILY_ERROR_CODES.INVALID_RELATIONSHIP,
    );
  }
  return value;
}

export type { RelationshipOrientation, FamilyManagementContext };
