import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAdminGlobalCustomerMatches,
  getVisibleCrmCustomers,
  getVisibleCustomerMatches,
  getVisibleRecipientDirectory,
  resolveRecipientMetaForScenario,
} from "./recipient-permissions";

describe("recipient-permissions", () => {
  it("staff A sees own CRM customers in directory", () => {
    const results = getVisibleRecipientDirectory(
      "staff_single",
      "john",
    );
    assert.ok(results.some((r) => r.email === "john@gmail.com"));
    assert.ok(!results.some((r) => r.email === "robert@example.com"));
  });

  it("staff A sees own customer match", () => {
    const matches = getVisibleCustomerMatches(
      "john@gmail.com",
      "staff_single",
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.name, "John Smith");
  });

  it("staff A does not see staff B customer in autocomplete data", () => {
    const customers = getVisibleCrmCustomers("staff_single");
    assert.ok(!customers.some((c) => c.email === "robert@example.com"));
  });

  it("staff A manual entry of staff B email does not reveal CRM metadata", () => {
    const meta = resolveRecipientMetaForScenario(
      "robert@example.com",
      "staff_single",
    );
    assert.equal(meta?.email, "robert@example.com");
    assert.equal(meta?.displayName, undefined);
    assert.equal(meta?.customerId, undefined);
    assert.equal(meta?.customerName, undefined);
    assert.equal(meta?.customerCode, undefined);
  });

  it("admin sees global CRM match", () => {
    const matches = getAdminGlobalCustomerMatches("robert@example.com");
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.name, "Robert Lee");
    assert.equal(matches[0]?.customerCode, "EF000200");
    assert.equal(matches[0]?.ownerName, "Employee B");
  });

  it("reports multiple authorized matches for same email", () => {
    const meta = resolveRecipientMetaForScenario(
      "info@shared-client.com",
      "staff_single",
    );
    assert.ok(meta?.multipleCrmMatches);
    assert.equal(meta?.multipleCrmMatches?.length, 2);
  });
});
