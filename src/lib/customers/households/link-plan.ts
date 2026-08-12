import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import {
  HOUSEHOLD_RELATIONSHIP_INVERSE,
  HOUSEHOLD_RELATIONSHIP_TYPES,
} from "../../../../drizzle/schema/household-relationship-types";
import { schema, type Database } from "@/lib/db";
import { resolveRelationshipFromCurrentPerspective } from "./detail-summary";

export type FamilyLinkPlan =
  | { kind: "create_household" }
  | { kind: "add_target_to_source_household"; householdId: string }
  | { kind: "add_source_to_target_household"; householdId: string }
  | { kind: "relation_only"; householdId: string }
  | { kind: "already_linked"; householdId: string }
  | { kind: "household_conflict" }
  | { kind: "relationship_conflict" }
  | { kind: "invalid_household_state" };

type MembershipSnapshot = {
  householdId: string;
  householdStatus: "active" | "dissolved";
};

type PairRelationshipSnapshot = {
  directType: HouseholdRelationshipType | null;
  reverseType: HouseholdRelationshipType | null;
  householdId: string | null;
};

export function isValidHouseholdRelationshipType(
  value: string,
): value is HouseholdRelationshipType {
  return (HOUSEHOLD_RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

export function relationshipMatchesSubmittedPerspective(
  submitted: HouseholdRelationshipType,
  directType: HouseholdRelationshipType | null,
  reverseType: HouseholdRelationshipType | null,
): "match" | "conflict" | "none" {
  if (directType) {
    return directType === submitted ? "match" : "conflict";
  }

  if (reverseType) {
    const canonical = resolveRelationshipFromCurrentPerspective(null, reverseType);
    if (canonical === submitted) {
      return "match";
    }

    if (
      submitted === "child" &&
      (reverseType === "son" || reverseType === "daughter")
    ) {
      return "match";
    }

    if (
      (submitted === "father" || submitted === "mother") &&
      reverseType === "child"
    ) {
      return "match";
    }

    if (
      submitted === "sibling" &&
      (reverseType === "brother" || reverseType === "sister")
    ) {
      return "match";
    }

    if (
      (submitted === "brother" || submitted === "sister") &&
      reverseType === "sibling"
    ) {
      return "match";
    }

    if (
      submitted === "grandchild" &&
      (reverseType === "grandson" || reverseType === "granddaughter")
    ) {
      return "match";
    }

    if (
      (submitted === "grandfather" || submitted === "grandmother") &&
      reverseType === "grandchild"
    ) {
      return "match";
    }

    if (
      submitted === "grandparent" &&
      (reverseType === "grandfather" ||
        reverseType === "grandmother" ||
        reverseType === "grandchild")
    ) {
      return reverseType === "grandchild" ? "match" : "conflict";
    }

    return "conflict";
  }

  return "none";
}

async function loadActiveMemberships(
  db: Database,
  customerIds: string[],
): Promise<Map<string, MembershipSnapshot>> {
  if (customerIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      customerId: schema.customerHouseholdMembers.customerId,
      householdId: schema.customerHouseholdMembers.householdId,
      householdStatus: schema.customerHouseholds.status,
    })
    .from(schema.customerHouseholdMembers)
    .innerJoin(
      schema.customerHouseholds,
      eq(schema.customerHouseholds.id, schema.customerHouseholdMembers.householdId),
    )
    .where(
      and(
        inArray(schema.customerHouseholdMembers.customerId, customerIds),
        isNull(schema.customerHouseholdMembers.leftAt),
      ),
    );

  return new Map(
    rows.map((row) => [
      row.customerId,
      {
        householdId: row.householdId,
        householdStatus: row.householdStatus,
      },
    ]),
  );
}

async function loadPairRelationships(
  db: Database,
  sourceId: string,
  targetId: string,
  householdIds: string[],
): Promise<PairRelationshipSnapshot> {
  if (householdIds.length === 0) {
    return { directType: null, reverseType: null, householdId: null };
  }

  const rows = await db
    .select({
      householdId: schema.customerHouseholdRelationships.householdId,
      fromCustomerId: schema.customerHouseholdRelationships.fromCustomerId,
      toCustomerId: schema.customerHouseholdRelationships.toCustomerId,
      relationshipType: schema.customerHouseholdRelationships.relationshipType,
    })
    .from(schema.customerHouseholdRelationships)
    .where(
      and(
        inArray(schema.customerHouseholdRelationships.householdId, householdIds),
        or(
          and(
            eq(schema.customerHouseholdRelationships.fromCustomerId, sourceId),
            eq(schema.customerHouseholdRelationships.toCustomerId, targetId),
          ),
          and(
            eq(schema.customerHouseholdRelationships.fromCustomerId, targetId),
            eq(schema.customerHouseholdRelationships.toCustomerId, sourceId),
          ),
        ),
      ),
    );

  let directType: HouseholdRelationshipType | null = null;
  let reverseType: HouseholdRelationshipType | null = null;
  let householdId: string | null = null;

  for (const row of rows) {
    householdId = row.householdId;
    if (row.fromCustomerId === sourceId && row.toCustomerId === targetId) {
      directType = row.relationshipType;
    }
    if (row.fromCustomerId === targetId && row.toCustomerId === sourceId) {
      reverseType = row.relationshipType;
    }
  }

  return { directType, reverseType, householdId };
}

export async function planFamilyLink(
  db: Database,
  sourceId: string,
  targetId: string,
  relationshipType: HouseholdRelationshipType,
): Promise<FamilyLinkPlan> {
  const memberships = await loadActiveMemberships(db, [sourceId, targetId]);
  const sourceMembership = memberships.get(sourceId) ?? null;
  const targetMembership = memberships.get(targetId) ?? null;

  if (
    sourceMembership?.householdStatus === "dissolved" ||
    targetMembership?.householdStatus === "dissolved"
  ) {
    return { kind: "invalid_household_state" };
  }

  const householdIds = [
    ...new Set(
      [sourceMembership?.householdId, targetMembership?.householdId].filter(
        (id): id is string => !!id,
      ),
    ),
  ];

  const pair = await loadPairRelationships(
    db,
    sourceId,
    targetId,
    householdIds,
  );

  const relationshipState = relationshipMatchesSubmittedPerspective(
    relationshipType,
    pair.directType,
    pair.reverseType,
  );

  if (relationshipState === "match") {
    return {
      kind: "already_linked",
      householdId:
        pair.householdId ??
        sourceMembership?.householdId ??
        targetMembership?.householdId ??
        "",
    };
  }

  if (relationshipState === "conflict") {
    return { kind: "relationship_conflict" };
  }

  const sourceHouseholdId = sourceMembership?.householdId ?? null;
  const targetHouseholdId = targetMembership?.householdId ?? null;

  if (sourceHouseholdId && targetHouseholdId && sourceHouseholdId !== targetHouseholdId) {
    return { kind: "household_conflict" };
  }

  if (!sourceHouseholdId && !targetHouseholdId) {
    return { kind: "create_household" };
  }

  if (sourceHouseholdId && !targetHouseholdId) {
    return {
      kind: "add_target_to_source_household",
      householdId: sourceHouseholdId,
    };
  }

  if (!sourceHouseholdId && targetHouseholdId) {
    return {
      kind: "add_source_to_target_household",
      householdId: targetHouseholdId,
    };
  }

  return {
    kind: "relation_only",
    householdId: sourceHouseholdId!,
  };
}

export function mapPlanToHouseholdAction(plan: FamilyLinkPlan): string {
  switch (plan.kind) {
    case "create_household":
      return "create_household";
    case "add_target_to_source_household":
      return "add_target_to_source_household";
    case "add_source_to_target_household":
      return "add_source_to_target_household";
    case "relation_only":
      return "relation_only";
    case "already_linked":
      return "already_linked";
    default:
      return plan.kind;
  }
}

export function inverseRelationshipForAudit(
  relationshipType: HouseholdRelationshipType,
): HouseholdRelationshipType | "parent" {
  return HOUSEHOLD_RELATIONSHIP_INVERSE[relationshipType];
}
