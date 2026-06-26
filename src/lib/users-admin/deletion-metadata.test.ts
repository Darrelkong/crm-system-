import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUserDeletionAuditMetadata,
  parseUserDeletionMetadata,
} from "./deletion-metadata";

describe("user deletion metadata", () => {
  it("builds audit metadata with actor and transfer counts", () => {
    const metadata = buildUserDeletionAuditMetadata({
      email: "staff@example.com",
      transferredCustomerCount: 3,
      actor: { id: "admin-1", displayName: "System Admin" },
    });

    assert.equal(metadata.transferredCustomerCount, 3);
    assert.equal(metadata.deletedByName, "System Admin");
    assert.equal(metadata.transferredToAdminName, "System Admin");
  });

  it("parses stored deletion metadata for admin UI", () => {
    const parsed = parseUserDeletionMetadata(
      JSON.stringify({
        email: "staff@example.com",
        transferredCustomerCount: 5,
        deletedByName: "Alice Admin",
        transferredToAdminName: "Alice Admin",
      }),
    );

    assert.equal(parsed.deleted_by_name, "Alice Admin");
    assert.equal(parsed.transferred_customer_count, 5);
    assert.equal(parsed.transferred_to_admin_name, "Alice Admin");
  });

  it("returns null fields for missing or invalid metadata", () => {
    assert.deepEqual(parseUserDeletionMetadata(null), {
      deleted_by_name: null,
      transferred_customer_count: null,
      transferred_to_admin_name: null,
    });
    assert.deepEqual(parseUserDeletionMetadata("{bad json"), {
      deleted_by_name: null,
      transferred_customer_count: null,
      transferred_to_admin_name: null,
    });
  });
});
