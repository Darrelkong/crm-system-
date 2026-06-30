import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getNotificationHref,
  isRelatedCustomerMissing,
} from "./queries";

const CUSTOMER_ID = "22222222-2222-2222-2222-222222222201";

describe("getNotificationHref", () => {
  it("returns customer href when customer exists", () => {
    assert.equal(
      getNotificationHref(
        {
          related_entity_type: "customer",
          related_entity_id: CUSTOMER_ID,
          related_entity_missing: false,
        },
        "staff",
      ),
      `/customers/${CUSTOMER_ID}`,
    );
  });

  it("returns null when related customer is missing", () => {
    assert.equal(
      getNotificationHref(
        {
          related_entity_type: "customer",
          related_entity_id: CUSTOMER_ID,
          related_entity_missing: true,
        },
        "staff",
      ),
      null,
    );
  });

  it("returns null when related_entity_id is null", () => {
    assert.equal(
      getNotificationHref(
        {
          related_entity_type: "customer",
          related_entity_id: null,
        },
        "staff",
      ),
      null,
    );
  });

  it("keeps approval href unchanged", () => {
    assert.equal(
      getNotificationHref(
        {
          related_entity_type: "approval",
          related_entity_id: "approval-1",
        },
        "staff",
      ),
      "/approvals",
    );
  });

  it("keeps backup href for admin", () => {
    assert.equal(
      getNotificationHref(
        {
          related_entity_type: "backup",
          related_entity_id: "backup-1",
        },
        "admin",
      ),
      "/admin/backups",
    );
  });

  it("returns null for backup href for staff", () => {
    assert.equal(
      getNotificationHref(
        {
          related_entity_type: "backup_job",
          related_entity_id: "backup-1",
        },
        "staff",
      ),
      null,
    );
  });
});

describe("isRelatedCustomerMissing", () => {
  it("returns true only for missing customer notifications", () => {
    assert.equal(
      isRelatedCustomerMissing({
        related_entity_type: "customer",
        related_entity_missing: true,
      }),
      true,
    );
    assert.equal(
      isRelatedCustomerMissing({
        related_entity_type: "customer",
        related_entity_missing: false,
      }),
      false,
    );
    assert.equal(
      isRelatedCustomerMissing({
        related_entity_type: "approval",
        related_entity_missing: true,
      }),
      false,
    );
  });

  it("does not throw for minimal item shape", () => {
    assert.doesNotThrow(() =>
      isRelatedCustomerMissing({ related_entity_type: null }),
    );
  });
});
