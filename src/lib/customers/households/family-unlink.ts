import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import { schema, type Database } from "@/lib/db";
import { extractChanges } from "@/lib/reclamation/auto-reclaim-cas";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";
import { loadFamilyManagementContext } from "./family-management-context";
import { writeFamilyUnlinkedAudit } from "./family-management-audit";
import {
  buildFamilyManagementApprovalCas,
  type UnlinkApprovalSnapshot,
} from "./family-management-cas";

export type UnlinkResult = {
  householdAction: "member_removed" | "household_dissolved";
  relationshipsRemoved: number;
};

type UnlinkAuditContext = {
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

function buildUnlinkStatements(
  db: Database,
  params: {
    householdId: string;
    targetId: string;
    targetMembershipId: string;
    activeMemberCount: number;
    actorId: string;
    now: string;
    approvalId?: string;
  },
): unknown[] {
  const {
    householdId,
    targetId,
    targetMembershipId,
    activeMemberCount,
    actorId,
    now,
    approvalId,
  } = params;
  const statements: unknown[] = [];
  const guarded = approvalId != null;

  if (activeMemberCount === 2) {
    if (guarded) {
      statements.push(
        db
          .update(schema.customerHouseholdMembers)
          .set({ leftAt: now, removedBy: actorId })
          .where(
            and(
              eq(schema.customerHouseholdMembers.householdId, householdId),
              isNull(schema.customerHouseholdMembers.leftAt),
              sql`(
                SELECT COUNT(*)
                FROM customer_household_members m
                WHERE m.household_id = ${householdId}
                  AND m.left_at IS NULL
              ) = 2`,
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
          .update(schema.customerHouseholdMembers)
          .set({ leftAt: now, removedBy: actorId })
          .where(
            and(
              eq(schema.customerHouseholdMembers.householdId, householdId),
              isNull(schema.customerHouseholdMembers.leftAt),
              sql`(
                SELECT COUNT(*)
                FROM customer_household_members m
                WHERE m.household_id = ${householdId}
                  AND m.left_at IS NULL
              ) = 2`,
            ),
          ),
      );
    }

    if (guarded) {
      statements.push(
        db.delete(schema.customerHouseholdRelationships).where(
          and(
            eq(schema.customerHouseholdRelationships.householdId, householdId),
            sql`EXISTS (
              SELECT 1 FROM approvals
              WHERE id = ${approvalId}
                AND status = 'approved'
            )`,
          ),
        ),
      );
      statements.push(
        db
          .update(schema.customerHouseholds)
          .set({
            status: "dissolved",
            dissolvedAt: now,
            dissolvedBy: actorId,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.customerHouseholds.id, householdId),
              eq(schema.customerHouseholds.status, "active"),
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
          .where(eq(schema.customerHouseholdRelationships.householdId, householdId)),
      );
      statements.push(
        db
          .update(schema.customerHouseholds)
          .set({
            status: "dissolved",
            dissolvedAt: now,
            dissolvedBy: actorId,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.customerHouseholds.id, householdId),
              eq(schema.customerHouseholds.status, "active"),
            ),
          ),
      );
    }
  } else {
    if (guarded) {
      statements.push(
        db
          .update(schema.customerHouseholdMembers)
          .set({ leftAt: now, removedBy: actorId })
          .where(
            and(
              eq(schema.customerHouseholdMembers.id, targetMembershipId),
              isNull(schema.customerHouseholdMembers.leftAt),
              sql`EXISTS (
                SELECT 1 FROM approvals
                WHERE id = ${approvalId}
                  AND status = 'approved'
              )`,
            ),
          ),
      );
      statements.push(
        db.delete(schema.customerHouseholdRelationships).where(
          and(
            eq(schema.customerHouseholdRelationships.householdId, householdId),
            or(
              eq(schema.customerHouseholdRelationships.fromCustomerId, targetId),
              eq(schema.customerHouseholdRelationships.toCustomerId, targetId),
            ),
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
          .update(schema.customerHouseholdMembers)
          .set({ leftAt: now, removedBy: actorId })
          .where(
            and(
              eq(schema.customerHouseholdMembers.id, targetMembershipId),
              isNull(schema.customerHouseholdMembers.leftAt),
            ),
          ),
      );
      statements.push(
        db
          .delete(schema.customerHouseholdRelationships)
          .where(
            and(
              eq(schema.customerHouseholdRelationships.householdId, householdId),
              or(
                eq(schema.customerHouseholdRelationships.fromCustomerId, targetId),
                eq(schema.customerHouseholdRelationships.toCustomerId, targetId),
              ),
            ),
          ),
      );
    }
  }

  return statements;
}

export async function executeFamilyUnlink(
  db: Database,
  params: {
    sourceId: string;
    targetId: string;
    actor: User;
    auditContext?: UnlinkAuditContext;
    approvalCas?: {
      approvalId: string;
      reviewerId: string;
      adminComment: string | null;
      now: string;
    };
    snapshot?: UnlinkApprovalSnapshot;
    testAppendStatements?: (ctx: { db: Database }) => unknown[];
  },
): Promise<UnlinkResult> {
  const context = await loadFamilyManagementContext(
    db,
    params.sourceId,
    params.targetId,
  );

  const relationshipCount = (
    await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.customerHouseholdRelationships)
      .where(
        and(
          eq(schema.customerHouseholdRelationships.householdId, context.householdId),
          or(
            eq(
              schema.customerHouseholdRelationships.fromCustomerId,
              params.targetId,
            ),
            eq(schema.customerHouseholdRelationships.toCustomerId, params.targetId),
          ),
        ),
      )
  )[0]?.count;

  const householdAction =
    context.activeMemberCount === 2 ? "household_dissolved" : "member_removed";

  const now = params.approvalCas?.now ?? new Date().toISOString();
  const statements = buildUnlinkStatements(db, {
    householdId: context.householdId,
    targetId: params.targetId,
    targetMembershipId: context.targetMembership.id,
    activeMemberCount: context.activeMemberCount,
    actorId: params.actor.id,
    now,
    approvalId: params.approvalCas?.approvalId,
  });

  if (params.approvalCas) {
    statements.unshift(
      buildFamilyManagementApprovalCas(db, {
        approvalId: params.approvalCas.approvalId,
        reviewerId: params.approvalCas.reviewerId,
        adminComment: params.approvalCas.adminComment,
        now,
        unlinkSnapshot: params.snapshot,
      }),
    );
  }

  if (params.testAppendStatements) {
    statements.push(...params.testAppendStatements({ db }));
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
  } else {
    const membershipResult = batchResults[0];
    const membershipChanges = extractChanges(membershipResult);
    if (membershipChanges !== 2 && context.activeMemberCount === 2) {
      throw new FamilyLinkError(
        409,
        "家庭成员状态已变更，无法解除关联",
        FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE,
      );
    }
    if (membershipChanges !== 1 && context.activeMemberCount !== 2) {
      throw new FamilyLinkError(
        409,
        "家庭成员状态已变更，无法解除关联",
        FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE,
      );
    }
  }

  await writeFamilyUnlinkedAudit(db, {
    source: context.source,
    target: context.target,
    householdId: context.householdId,
    householdAction,
    relationshipsRemoved: relationshipCount ?? 0,
    actor: params.actor,
    auditContext: params.auditContext,
  });

  return {
    householdAction,
    relationshipsRemoved: relationshipCount ?? 0,
  };
}
