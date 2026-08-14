import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import type { RelationshipOrientation } from "./family-management-context";

export type RelationshipApprovalSnapshot = {
  householdId: string;
  requestedRelationshipType: HouseholdRelationshipType;
  expectedRelationshipState: RelationshipOrientation;
  expectedRelationshipRowId: string | null;
  expectedRelationshipType: HouseholdRelationshipType | null;
  expectedRelationshipUpdatedAt: string | null;
  sourceId: string;
  targetId: string;
};

export type UnlinkApprovalSnapshot = {
  householdId: string;
  targetMembershipId: string;
  targetMembershipJoinedAt: string;
  expectedActiveMemberCount: number;
  sourceId: string;
  targetId: string;
};

function relationshipSnapshotStillValid(snapshot: RelationshipApprovalSnapshot) {
  const { sourceId, targetId, householdId } = snapshot;

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
  )
  AND (
    ${snapshot.expectedRelationshipState} = 'none'
    AND NOT EXISTS (
      SELECT 1
      FROM customer_household_relationships r
      WHERE r.household_id = ${householdId}
        AND (
          (r.from_customer_id = ${sourceId} AND r.to_customer_id = ${targetId})
          OR (r.from_customer_id = ${targetId} AND r.to_customer_id = ${sourceId})
        )
    )
    OR (
      ${snapshot.expectedRelationshipState} = 'direct'
      AND EXISTS (
        SELECT 1
        FROM customer_household_relationships r
        WHERE r.id = ${snapshot.expectedRelationshipRowId}
          AND r.household_id = ${householdId}
          AND r.from_customer_id = ${sourceId}
          AND r.to_customer_id = ${targetId}
          AND r.relationship_type = ${snapshot.expectedRelationshipType}
          AND r.updated_at = ${snapshot.expectedRelationshipUpdatedAt}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM customer_household_relationships r
        WHERE r.household_id = ${householdId}
          AND r.from_customer_id = ${targetId}
          AND r.to_customer_id = ${sourceId}
      )
    )
    OR (
      ${snapshot.expectedRelationshipState} = 'reverse'
      AND EXISTS (
        SELECT 1
        FROM customer_household_relationships r
        WHERE r.id = ${snapshot.expectedRelationshipRowId}
          AND r.household_id = ${householdId}
          AND r.from_customer_id = ${targetId}
          AND r.to_customer_id = ${sourceId}
          AND r.relationship_type = ${snapshot.expectedRelationshipType}
          AND r.updated_at = ${snapshot.expectedRelationshipUpdatedAt}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM customer_household_relationships r
        WHERE r.household_id = ${householdId}
          AND r.from_customer_id = ${sourceId}
          AND r.to_customer_id = ${targetId}
      )
    )
  )`;
}

function unlinkSnapshotStillValid(snapshot: UnlinkApprovalSnapshot) {
  return sql`EXISTS (
    SELECT 1
    FROM customer_households h
    WHERE h.id = ${snapshot.householdId}
      AND h.status = 'active'
  )
  AND EXISTS (
    SELECT 1
    FROM customer_household_members sm
    WHERE sm.household_id = ${snapshot.householdId}
      AND sm.customer_id = ${snapshot.sourceId}
      AND sm.left_at IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM customer_household_members tm
    WHERE tm.id = ${snapshot.targetMembershipId}
      AND tm.household_id = ${snapshot.householdId}
      AND tm.customer_id = ${snapshot.targetId}
      AND tm.joined_at = ${snapshot.targetMembershipJoinedAt}
      AND tm.left_at IS NULL
  )
  AND (
    SELECT COUNT(*)
    FROM customer_household_members m
    WHERE m.household_id = ${snapshot.householdId}
      AND m.left_at IS NULL
  ) = ${snapshot.expectedActiveMemberCount}`;
}

export function buildFamilyManagementApprovalCas(
  db: Database,
  params: {
    approvalId: string;
    reviewerId: string;
    adminComment: string | null;
    now: string;
    relationshipSnapshot?: RelationshipApprovalSnapshot;
    unlinkSnapshot?: UnlinkApprovalSnapshot;
  },
) {
  const snapshotGuard = params.relationshipSnapshot
    ? relationshipSnapshotStillValid(params.relationshipSnapshot)
    : params.unlinkSnapshot
      ? unlinkSnapshotStillValid(params.unlinkSnapshot)
      : sql`1 = 1`;

  return db
    .update(schema.approvals)
    .set({
      status: "approved",
      adminComment: params.adminComment,
      reviewedBy: params.reviewerId,
      reviewedAt: params.now,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(schema.approvals.id, params.approvalId),
        eq(schema.approvals.status, "pending"),
        snapshotGuard,
      ),
    );
}

export function buildPendingFamilyManagementPairNotExistsSql(
  sourceId: string,
  targetId: string,
) {
  return sql`NOT EXISTS (
    SELECT 1
    FROM approvals a
    WHERE a.request_type IN ('update_family_relationship', 'unlink_family_customer')
      AND a.status = 'pending'
      AND (
        (
          a.customer_id = ${sourceId}
          AND json_extract(a.related_customer_ids, '$[0]') = ${targetId}
        )
        OR (
          a.customer_id = ${targetId}
          AND json_extract(a.related_customer_ids, '$[0]') = ${sourceId}
        )
      )
  )`;
}
