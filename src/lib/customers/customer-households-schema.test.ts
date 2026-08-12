import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_HOUSEHOLD_STATUSES,
  type CustomerHousehold,
  type NewCustomerHousehold,
} from "../../../drizzle/schema/customer-households";
import {
  type CustomerHouseholdMember,
  type NewCustomerHouseholdMember,
} from "../../../drizzle/schema/customer-household-members";
import {
  HOUSEHOLD_RELATIONSHIP_TYPES,
  type CustomerHouseholdRelationship,
  type HouseholdRelationshipType,
  type NewCustomerHouseholdRelationship,
} from "../../../drizzle/schema/customer-household-relationships";
import {
  HOUSEHOLD_RELATIONSHIP_INVERSE,
  type HouseholdRelationshipInverseLabel,
} from "../../../drizzle/schema/household-relationship-types";

describe("customer household schema types", () => {
  it("exports household status union", () => {
    assert.deepEqual(CUSTOMER_HOUSEHOLD_STATUSES, ["active", "dissolved"]);
    const status: CustomerHousehold["status"] = "active";
    assert.equal(status, "active");
    const draft: NewCustomerHousehold = {
      id: "hh-1",
      status: "active",
      createdBy: "u1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(draft.status, "active");
  });

  it("exports household member types without separate status column", () => {
    const member: CustomerHouseholdMember = {
      id: "hm-1",
      householdId: "hh-1",
      customerId: "c1",
      joinedAt: "2026-01-01T00:00:00.000Z",
      joinedBy: "u1",
      leftAt: null,
      removedBy: null,
    };
    assert.equal(member.leftAt, null);

    const draft: NewCustomerHouseholdMember = {
      id: "hm-2",
      householdId: "hh-1",
      customerId: "c2",
      joinedAt: "2026-01-01T00:00:00.000Z",
      joinedBy: "u1",
    };
    assert.equal(draft.leftAt, undefined);
  });

  it("exports relationship type union and inverse map", () => {
    assert.equal(HOUSEHOLD_RELATIONSHIP_TYPES.length, 16);
    assert.ok(HOUSEHOLD_RELATIONSHIP_TYPES.includes("father"));
    assert.ok(!HOUSEHOLD_RELATIONSHIP_TYPES.includes("friend" as never));

    const rel: HouseholdRelationshipType = "spouse";
    assert.equal(HOUSEHOLD_RELATIONSHIP_INVERSE[rel], "spouse");

    const inverse: HouseholdRelationshipInverseLabel =
      HOUSEHOLD_RELATIONSHIP_INVERSE.son;
    assert.equal(inverse, "parent");

    const row: CustomerHouseholdRelationship = {
      id: "hr-1",
      householdId: "hh-1",
      fromCustomerId: "c1",
      toCustomerId: "c2",
      relationshipType: "father",
      remark: null,
      createdBy: "u1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(row.relationshipType, "father");

    const draft: NewCustomerHouseholdRelationship = {
      id: "hr-2",
      householdId: "hh-1",
      fromCustomerId: "c1",
      toCustomerId: "c2",
      relationshipType: "mother",
      createdBy: "u1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(draft.relationshipType, "mother");
  });
});
