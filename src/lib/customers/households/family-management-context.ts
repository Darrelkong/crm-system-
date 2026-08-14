import { and, eq, isNull, sql } from "drizzle-orm";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { CustomerHouseholdMember } from "../../../../drizzle/schema/customer-household-members";
import type { CustomerHouseholdRelationship } from "../../../../drizzle/schema/customer-household-relationships";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import { schema, type Database } from "@/lib/db";
import {
  resolveRelationshipFromCurrentPerspective,
  type CustomerFamilyMemberRelationship,
} from "./detail-summary";
import { FAMILY_ERROR_CODES, FamilyLinkError } from "./errors";

export type RelationshipOrientation =
  | "none"
  | "direct"
  | "reverse"
  | "invalid_both_directions";

export type FamilyManagementContext = {
  source: Customer;
  target: Customer;
  householdId: string;
  sourceMembership: CustomerHouseholdMember;
  targetMembership: CustomerHouseholdMember;
  activeMemberCount: number;
  relationshipOrientation: RelationshipOrientation;
  directRelationship: CustomerHouseholdRelationship | null;
  reverseRelationship: CustomerHouseholdRelationship | null;
  currentPerspectiveRelationship: CustomerFamilyMemberRelationship | null;
};

export async function loadFamilyManagementContext(
  db: Database,
  sourceId: string,
  targetId: string,
): Promise<FamilyManagementContext> {
  if (sourceId === targetId) {
    throw new FamilyLinkError(
      400,
      "不能将客户关联到自身",
      FAMILY_ERROR_CODES.SELF_LINK_NOT_ALLOWED,
    );
  }

  const [source, target] = await Promise.all([
    db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, sourceId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, targetId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
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

  const sourceMembershipRows = await db
    .select({
      membership: schema.customerHouseholdMembers,
      householdStatus: schema.customerHouseholds.status,
    })
    .from(schema.customerHouseholdMembers)
    .innerJoin(
      schema.customerHouseholds,
      eq(schema.customerHouseholds.id, schema.customerHouseholdMembers.householdId),
    )
    .where(
      and(
        eq(schema.customerHouseholdMembers.customerId, sourceId),
        isNull(schema.customerHouseholdMembers.leftAt),
        eq(schema.customerHouseholds.status, "active"),
      ),
    )
    .limit(1);

  const sourceMembershipRow = sourceMembershipRows[0];
  if (!sourceMembershipRow) {
    throw new FamilyLinkError(
      409,
      "当前客户不在有效家庭中",
      FAMILY_ERROR_CODES.INVALID_HOUSEHOLD_STATE,
    );
  }

  const householdId = sourceMembershipRow.membership.householdId;

  const targetMembershipRows = await db
    .select()
    .from(schema.customerHouseholdMembers)
    .where(
      and(
        eq(schema.customerHouseholdMembers.householdId, householdId),
        eq(schema.customerHouseholdMembers.customerId, targetId),
        isNull(schema.customerHouseholdMembers.leftAt),
      ),
    )
    .limit(1);

  const targetMembership = targetMembershipRows[0];
  if (!targetMembership) {
    throw new FamilyLinkError(
      409,
      "该客户不是当前家庭的成员",
      FAMILY_ERROR_CODES.TARGET_NOT_IN_HOUSEHOLD,
    );
  }

  const activeMemberCount = (
    await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.customerHouseholdMembers)
      .where(
        and(
          eq(schema.customerHouseholdMembers.householdId, householdId),
          isNull(schema.customerHouseholdMembers.leftAt),
        ),
      )
  )[0]?.count;

  const relationshipRows = await db
    .select()
    .from(schema.customerHouseholdRelationships)
    .where(
      and(
        eq(schema.customerHouseholdRelationships.householdId, householdId),
        sql`(
          (${schema.customerHouseholdRelationships.fromCustomerId} = ${sourceId}
            AND ${schema.customerHouseholdRelationships.toCustomerId} = ${targetId})
          OR
          (${schema.customerHouseholdRelationships.fromCustomerId} = ${targetId}
            AND ${schema.customerHouseholdRelationships.toCustomerId} = ${sourceId})
        )`,
      ),
    );

  const directRelationship =
    relationshipRows.find(
      (row) =>
        row.fromCustomerId === sourceId && row.toCustomerId === targetId,
    ) ?? null;
  const reverseRelationship =
    relationshipRows.find(
      (row) =>
        row.fromCustomerId === targetId && row.toCustomerId === sourceId,
    ) ?? null;

  let relationshipOrientation: RelationshipOrientation;
  if (directRelationship && reverseRelationship) {
    relationshipOrientation = "invalid_both_directions";
  } else if (directRelationship) {
    relationshipOrientation = "direct";
  } else if (reverseRelationship) {
    relationshipOrientation = "reverse";
  } else {
    relationshipOrientation = "none";
  }

  return {
    source,
    target,
    householdId,
    sourceMembership: sourceMembershipRow.membership,
    targetMembership,
    activeMemberCount: activeMemberCount ?? 0,
    relationshipOrientation,
    directRelationship,
    reverseRelationship,
    currentPerspectiveRelationship: resolveRelationshipFromCurrentPerspective(
      directRelationship?.relationshipType ?? null,
      reverseRelationship?.relationshipType ?? null,
    ),
  };
}

export function buildRelationshipSnapshot(
  context: FamilyManagementContext,
): {
  expectedRelationshipState: RelationshipOrientation;
  expectedRelationshipRowId: string | null;
  expectedRelationshipType: HouseholdRelationshipType | null;
  expectedRelationshipUpdatedAt: string | null;
} {
  const row =
    context.relationshipOrientation === "direct"
      ? context.directRelationship
      : context.relationshipOrientation === "reverse"
        ? context.reverseRelationship
        : null;

  return {
    expectedRelationshipState: context.relationshipOrientation,
    expectedRelationshipRowId: row?.id ?? null,
    expectedRelationshipType: row?.relationshipType ?? null,
    expectedRelationshipUpdatedAt: row?.updatedAt ?? null,
  };
}

export function buildUnlinkSnapshot(context: FamilyManagementContext): {
  householdId: string;
  targetMembershipId: string;
  targetMembershipJoinedAt: string;
  expectedActiveMemberCount: number;
} {
  return {
    householdId: context.householdId,
    targetMembershipId: context.targetMembership.id,
    targetMembershipJoinedAt: context.targetMembership.joinedAt,
    expectedActiveMemberCount: context.activeMemberCount,
  };
}
