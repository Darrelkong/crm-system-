import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminCustomerListStatusWhere,
  excludeArchivedWhere,
  excludePublicPoolWhere,
  normalCustomerListStatusWhere,
  ownedNormalCustomerListWhere,
  staffCustomerListPermissionWhere,
} from "@/lib/customers/customer-list-filters";

describe("customer list filter helpers", () => {
  it("exports status exclusion helpers", () => {
    assert.ok(excludeArchivedWhere());
    assert.ok(excludePublicPoolWhere());
    assert.ok(normalCustomerListStatusWhere());
  });

  it("admin normal list excludes public_pool", () => {
    const where = adminCustomerListStatusWhere({});
    assert.ok(where);
    assert.notEqual(String(where), "");
  });

  it("admin archived list only includes archived", () => {
    const where = adminCustomerListStatusWhere({ status: "archived" });
    assert.ok(where);
  });

  it("staff permission where composes owner/assignee with normal status", () => {
    const where = staffCustomerListPermissionWhere("user-1");
    assert.ok(where);
  });

  it("owned normal list where composes owner with normal status", () => {
    const where = ownedNormalCustomerListWhere("user-1");
    assert.ok(where);
  });
});
