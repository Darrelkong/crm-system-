import type { Customer } from "../../../../drizzle/schema/customers";
import type { HouseholdRelationshipType } from "../../../../drizzle/schema/household-relationship-types";
import type { User } from "../../../../drizzle/schema/users";
import { writeAuditLog } from "@/lib/audit/audit-log";
import type { Database } from "@/lib/db";
import type { CustomerFamilyMemberRelationship } from "./detail-summary";
import { inverseRelationshipForAudit } from "./link-plan";
import type { RelationshipOrientation } from "./family-management-context";

type FamilyManagementAuditContext = {
  approvalId?: string;
  requestedBy?: string;
  reviewedBy?: string;
};

export async function writeFamilyRelationshipUpdatedAudit(
  db: Database,
  params: {
    source: Customer;
    target: Customer;
    householdId: string;
    previousRelationship: CustomerFamilyMemberRelationship | null;
    newRelationship: HouseholdRelationshipType;
    relationshipOrientationNormalized: RelationshipOrientation;
    actor: User;
    auditContext?: FamilyManagementAuditContext;
  },
): Promise<void> {
  const {
    source,
    target,
    householdId,
    previousRelationship,
    newRelationship,
    relationshipOrientationNormalized,
    actor,
    auditContext,
  } = params;

  const approvalMetadata = auditContext?.approvalId
    ? {
        approvalId: auditContext.approvalId,
        requestedBy: auditContext.requestedBy,
        reviewedBy: auditContext.reviewedBy,
      }
    : {};

  await writeAuditLog(
    {
      userId: actor.id,
      action: "customer.family_relationship_updated",
      entityType: "customer",
      entityId: source.id,
      metadata: {
        householdId,
        otherCustomerId: target.id,
        previousRelationship,
        newRelationship,
        relationshipOrientationNormalized,
        ...approvalMetadata,
      },
    },
    db,
  );

  await writeAuditLog(
    {
      userId: actor.id,
      action: "customer.family_relationship_updated",
      entityType: "customer",
      entityId: target.id,
      metadata: {
        householdId,
        otherCustomerId: source.id,
        previousRelationship: inverseRelationshipForAudit(newRelationship),
        newRelationship: inverseRelationshipForAudit(newRelationship),
        relationshipOrientationNormalized,
        ...approvalMetadata,
      },
    },
    db,
  );
}

export async function writeFamilyUnlinkedAudit(
  db: Database,
  params: {
    source: Customer;
    target: Customer;
    householdId: string;
    householdAction: "member_removed" | "household_dissolved";
    relationshipsRemoved: number;
    actor: User;
    auditContext?: FamilyManagementAuditContext;
  },
): Promise<void> {
  const {
    source,
    target,
    householdId,
    householdAction,
    relationshipsRemoved,
    actor,
    auditContext,
  } = params;

  const approvalMetadata = auditContext?.approvalId
    ? {
        approvalId: auditContext.approvalId,
        requestedBy: auditContext.requestedBy,
        reviewedBy: auditContext.reviewedBy,
      }
    : {};

  const metadata = {
    householdId,
    removedCustomerId: target.id,
    householdAction,
    relationshipsRemoved,
    ...approvalMetadata,
  };

  await writeAuditLog(
    {
      userId: actor.id,
      action: "customer.family_unlinked",
      entityType: "customer",
      entityId: source.id,
      metadata,
    },
    db,
  );

  await writeAuditLog(
    {
      userId: actor.id,
      action: "customer.family_unlinked",
      entityType: "customer",
      entityId: target.id,
      metadata: {
        ...metadata,
        removedCustomerId: target.id,
      },
    },
    db,
  );
}
