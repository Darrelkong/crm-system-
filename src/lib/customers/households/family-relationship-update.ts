import { and, eq, sql } from "drizzle-orm";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import type { User } from "../../../../drizzle/schema/users";
import { schema, type Database } from "@/lib/db";
import { extractChanges } from "@/lib/reclamation/auto-reclaim-cas";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import {
  loadFamilyManagementContext,
  requiresRelationshipMutation,
  type FamilyManagementContext,
  type RelationshipOrientation,
} from "./family-management-context";
import { writeFamilyRelationshipUpdatedAudit } from "./family-management-audit";
import { isValidHouseholdRelationshipType } from "./link-plan";
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

function activeMembershipGuard(
  householdId: string,
  sourceId: string,
  targetId: string,
) {
  return sql`EXISTS (
    SELECT 1
    FROM customer_households h
    WHERE h.id = ${householdId}
      AND h.status = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM customer_household_members sm
    WHERE sm.household_id = ${householdId}
      AND sm.customer_id = ${sourceId}
      AND sm.left_at IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM customer_household_members tm
    WHERE tm.household_id = ${householdId}
      AND tm.customer_id = ${targetId}
      AND tm.left_at IS NULL
  )`;
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
  const membershipGuard = activeMembershipGuard(
    householdId,
    source.id,
    target.id,
  );

  if (reverseRelationship) {
    const reverseWhere = and(
      eq(schema.customerHouseholdRelationships.id, reverseRelationship.id),
      eq(
        schema.customerHouseholdRelationships.fromCustomerId,
        reverseRelationship.fromCustomerId,
      ),
      eq(
        schema.customerHouseholdRelationships.toCustomerId,
        reverseRelationship.toCustomerId,
      ),
      eq(
        schema.customerHouseholdRelationships.relationshipType,
        reverseRelationship.relationshipType,
      ),
      eq(
        schema.customerHouseholdRelationships.updatedAt,
        reverseRelationship.updatedAt,
      ),
      guarded
        ? sql`EXISTS (
            SELECT 1 FROM approvals
            WHERE id = ${approvalId}
              AND status = 'approved'
          )`
        : membershipGuard,
    );

    statements.push(
      db
        .delete(schema.customerHouseholdRelationships)
        .where(reverseWhere),
    );
  }

  if (directRelationship) {
    const directWhere = and(
      eq(schema.customerHouseholdRelationships.id, directRelationship.id),
      eq(
        schema.customerHouseholdRelationships.relationshipType,
        directRelationship.relationshipType,
      ),
      eq(
        schema.customerHouseholdRelationships.updatedAt,
        directRelationship.updatedAt,
      ),
      guarded
        ? sql`EXISTS (
            SELECT 1 FROM approvals
            WHERE id = ${approvalId}
              AND status = 'approved'
          )`
        : membershipGuard,
    );

    statements.push(
      db
        .update(schema.customerHouseholdRelationships)
        .set({
          relationshipType,
          updatedAt: now,
        })
        .where(directWhere),
    );
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
            FROM customer_households h
            WHERE h.id = ${householdId}
              AND h.status = 'active'
              AND EXISTS (
                SELECT 1
                FROM customer_household_members sm
                WHERE sm.household_id = ${householdId}
                  AND sm.customer_id = ${source.id}
                  AND sm.left_at IS NULL
              )
              AND EXISTS (
                SELECT 1
                FROM customer_household_members tm
                WHERE tm.household_id = ${householdId}
                  AND tm.customer_id = ${target.id}
                  AND tm.left_at IS NULL
              )
              AND NOT EXISTS (
                SELECT 1
                FROM customer_household_relationships r
                WHERE r.household_id = ${householdId}
                  AND (
                    (r.from_customer_id = ${source.id} AND r.to_customer_id = ${target.id})
                    OR (r.from_customer_id = ${target.id} AND r.to_customer_id = ${source.id})
                  )
              )
          `,
        ),
      );
    }
  }

  return statements;
}

function assertDirectMutationApplied(
  batchResults: readonly unknown[],
  mutationStartIndex: number,
): void {
  const firstMutationResult = batchResults[mutationStartIndex];
  const changes = extractChanges(firstMutationResult);
  if (changes !== 1) {
    throw new FamilyLinkError(
      409,
      "家庭状态已变更，无法更新关系",
      FAMILY_ERROR_CODES.APPROVAL_STALE,
    );
  }
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
    testAfterContextLoad?: (ctx: {
      db: Database;
      context: FamilyManagementContext;
    }) => Promise<void>;
  },
): Promise<RelationshipUpdateResult> {
  const context = await loadFamilyManagementContext(
    db,
    params.sourceId,
    params.targetId,
  );

  if (params.testAfterContextLoad) {
    await params.testAfterContextLoad({ db, context });
  }

  const mutationRequired = requiresRelationshipMutation(
    context,
    params.relationshipType,
  );

  if (!params.approvalCas && !mutationRequired) {
    return { kind: "no_change" };
  }

  const now = params.approvalCas?.now ?? new Date().toISOString();
  const previousOrientation = context.relationshipOrientation;
  const previousRelationship = context.currentPerspectiveRelationship;

  const statements: unknown[] = [];

  if (params.approvalCas) {
    statements.push(
      buildFamilyManagementApprovalCas(db, {
        approvalId: params.approvalCas.approvalId,
        reviewerId: params.approvalCas.reviewerId,
        adminComment: params.approvalCas.adminComment,
        now,
        relationshipSnapshot: params.snapshot,
      }),
    );
  }

  if (mutationRequired) {
    statements.push(
      ...buildRelationshipUpdateStatements(
        db,
        context,
        params.relationshipType,
        params.actor.id,
        now,
        params.approvalCas?.approvalId,
      ),
    );
  }

  if (params.testAppendStatements) {
    statements.push(...params.testAppendStatements({ db }));
  }

  if (statements.length === 0) {
    throw new FamilyLinkError(
      409,
      "家庭状态已变更，无法更新关系",
      FAMILY_ERROR_CODES.APPROVAL_STALE,
    );
  }

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

  if (mutationRequired) {
    const mutationStartIndex = params.approvalCas ? 1 : 0;
    if (!params.approvalCas) {
      assertDirectMutationApplied(batchResults, mutationStartIndex);
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

  return { kind: "no_change" };
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
