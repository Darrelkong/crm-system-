import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  draftCustomerAssociationFieldsForPatch,
  isMailCustomerAssociationType,
  parseDraftCustomerAssociationPatch,
} from "@/lib/mail/mail-customer-association-service";
import { MailServiceError } from "@/lib/mail/errors";

describe("mail customer association service helpers", () => {
  it("accepts manual and auto_match association types only", () => {
    assert.equal(isMailCustomerAssociationType("manual"), true);
    assert.equal(isMailCustomerAssociationType("auto_match"), true);
    assert.equal(isMailCustomerAssociationType("automatic"), false);
  });

  it("parses clear association patch", () => {
    assert.deepEqual(parseDraftCustomerAssociationPatch({ customerId: null }), {
      clear: true,
    });
  });

  it("parses set association patch", () => {
    assert.deepEqual(
      parseDraftCustomerAssociationPatch({
        customerId: "cust-1",
        customerAssociationType: "manual",
      }),
      { customerId: "cust-1", associationType: "manual" },
    );
  });

  it("rejects missing association type when setting customerId", () => {
    assert.throws(
      () => parseDraftCustomerAssociationPatch({ customerId: "cust-1" }),
      (error: unknown) =>
        error instanceof MailServiceError && error.errorCode === "VALIDATION",
    );
  });

  it("sets manual actor metadata and timestamps", () => {
    const fields = draftCustomerAssociationFieldsForPatch(
      { customerId: "cust-1", associationType: "manual" },
      "user-1",
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(fields.customerId, "cust-1");
    assert.equal(fields.customerAssociationType, "manual");
    assert.equal(fields.customerAssociatedByUserId, "user-1");
    assert.equal(fields.customerAssociatedAt, "2026-01-01T00:00:00.000Z");
  });

  it("clears auto_match actor metadata", () => {
    const fields = draftCustomerAssociationFieldsForPatch(
      { customerId: "cust-1", associationType: "auto_match" },
      "user-1",
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(fields.customerAssociationType, "auto_match");
    assert.equal(fields.customerAssociatedByUserId, null);
    assert.ok(fields.customerAssociatedAt);
  });

  it("clears all association columns together", () => {
    const fields = draftCustomerAssociationFieldsForPatch(
      { clear: true },
      "user-1",
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(fields.customerId, null);
    assert.equal(fields.customerAssociationType, null);
    assert.equal(fields.customerAssociatedByUserId, null);
    assert.equal(fields.customerAssociatedAt, null);
  });
});
