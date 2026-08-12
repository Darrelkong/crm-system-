import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Customer } from "../../../../drizzle/schema/customers";
import type { User } from "../../../../drizzle/schema/users";
import {
  HOUSEHOLD_RELATIONSHIP_INVERSE,
  type HouseholdRelationshipInverseLabel,
  type HouseholdRelationshipType,
} from "../../../../drizzle/schema/household-relationship-types";
import { schema, type Database } from "@/lib/db";
import { getCustomerAccessLevel } from "@/lib/permissions/customers";

export type CustomerFamilyMemberRelationship =
  | HouseholdRelationshipType
  | HouseholdRelationshipInverseLabel;

export type CustomerFamilyDetailSummary = {
  members: Array<{
    customerId: string;
    customerName: string;
    relationshipType: CustomerFamilyMemberRelationship | null;
  }>;
  hasProtectedMembers: boolean;
};

type HouseholdMemberRow = {
  memberCustomerId: string;
  memberCustomerName: string;
  memberOwnerId: string | null;
  memberStatus: Customer["status"];
  directRelationshipType: HouseholdRelationshipType | null;
  reverseRelationshipType: HouseholdRelationshipType | null;
  isAssignee: number;
};

export function resolveRelationshipFromCurrentPerspective(
  directRelationshipType: HouseholdRelationshipType | null,
  reverseRelationshipType: HouseholdRelationshipType | null,
): CustomerFamilyMemberRelationship | null {
  if (directRelationshipType) {
    return directRelationshipType;
  }
  if (reverseRelationshipType) {
    return HOUSEHOLD_RELATIONSHIP_INVERSE[reverseRelationshipType];
  }
  return null;
}

function canIdentifyFamilyMember(
  user: User,
  member: Pick<Customer, "ownerId" | "status">,
  isAssignee: boolean,
): boolean {
  const level = getCustomerAccessLevel(user, member as Customer, { isAssignee });
  return level === "full" || level === "archived_basic";
}

export async function getCustomerHouseholdDetailSummary(
  db: Database,
  user: User,
  currentCustomer: Pick<Customer, "id">,
): Promise<CustomerFamilyDetailSummary | null> {
  const otherMember = alias(schema.customerHouseholdMembers, "other_member");
  const otherCustomer = alias(schema.customers, "other_customer");
  const directRel = alias(schema.customerHouseholdRelationships, "direct_rel");
  const reverseRel = alias(schema.customerHouseholdRelationships, "reverse_rel");

  const rows = (await db
    .select({
      memberCustomerId: otherCustomer.id,
      memberCustomerName: otherCustomer.customerName,
      memberOwnerId: otherCustomer.ownerId,
      memberStatus: otherCustomer.status,
      directRelationshipType: directRel.relationshipType,
      reverseRelationshipType: reverseRel.relationshipType,
      isAssignee: sql<number>`CASE WHEN EXISTS (
        SELECT 1 FROM customer_assignees ca
        WHERE ca.customer_id = ${otherCustomer.id}
          AND ca.user_id = ${user.id}
      ) THEN 1 ELSE 0 END`,
    })
    .from(schema.customerHouseholdMembers)
    .innerJoin(
      schema.customerHouseholds,
      eq(schema.customerHouseholds.id, schema.customerHouseholdMembers.householdId),
    )
    .innerJoin(
      otherMember,
      and(
        eq(otherMember.householdId, schema.customerHouseholds.id),
        ne(otherMember.customerId, schema.customerHouseholdMembers.customerId),
        isNull(otherMember.leftAt),
      ),
    )
    .innerJoin(
      otherCustomer,
      and(
        eq(otherCustomer.id, otherMember.customerId),
        isNull(otherCustomer.deletedAt),
      ),
    )
    .leftJoin(
      directRel,
      and(
        eq(directRel.householdId, schema.customerHouseholds.id),
        eq(directRel.fromCustomerId, schema.customerHouseholdMembers.customerId),
        eq(directRel.toCustomerId, otherMember.customerId),
      ),
    )
    .leftJoin(
      reverseRel,
      and(
        eq(reverseRel.householdId, schema.customerHouseholds.id),
        eq(reverseRel.fromCustomerId, otherMember.customerId),
        eq(reverseRel.toCustomerId, schema.customerHouseholdMembers.customerId),
      ),
    )
    .where(
      and(
        eq(schema.customerHouseholdMembers.customerId, currentCustomer.id),
        isNull(schema.customerHouseholdMembers.leftAt),
        eq(schema.customerHouseholds.status, "active"),
      ),
    )) as HouseholdMemberRow[];

  if (rows.length === 0) {
    return null;
  }

  const members: CustomerFamilyDetailSummary["members"] = [];
  let hasProtectedMembers = false;

  for (const row of rows) {
    const memberCustomer = {
      ownerId: row.memberOwnerId,
      status: row.memberStatus,
    } as Customer;

    if (
      !canIdentifyFamilyMember(user, memberCustomer, row.isAssignee === 1)
    ) {
      hasProtectedMembers = true;
      continue;
    }

    members.push({
      customerId: row.memberCustomerId,
      customerName: row.memberCustomerName,
      relationshipType: resolveRelationshipFromCurrentPerspective(
        row.directRelationshipType,
        row.reverseRelationshipType,
      ),
    });
  }

  return { members, hasProtectedMembers };
}
