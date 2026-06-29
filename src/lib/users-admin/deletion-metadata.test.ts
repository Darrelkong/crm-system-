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
    assert.equal(parsed.primary_assignees_transferred_count, null);
    assert.equal(parsed.collaborator_assignees_removed_count, null);
  });

  it("parses assignee sync counts from audit metadata", () => {
    const parsed = parseUserDeletionMetadata(
      JSON.stringify({
        email: "staff@example.com",
        transferredCustomerCount: 2,
        deletedByName: "Alice Admin",
        transferredToAdminName: "Alice Admin",
        primaryAssigneesTransferredCount: 2,
        collaboratorAssigneesRemovedCount: 3,
      }),
    );

    assert.equal(parsed.primary_assignees_transferred_count, 2);
    assert.equal(parsed.collaborator_assignees_removed_count, 3);
  });

  it("returns null assignee counts when legacy metadata omits them", () => {
    const parsed = parseUserDeletionMetadata(
      JSON.stringify({
        transferredCustomerCount: 1,
        deletedByName: "Legacy Admin",
      }),
    );

    assert.equal(parsed.transferred_customer_count, 1);
    assert.equal(parsed.primary_assignees_transferred_count, null);
    assert.equal(parsed.collaborator_assignees_removed_count, null);
  });

  it("returns null fields for missing or invalid metadata", () => {
    assert.deepEqual(parseUserDeletionMetadata(null), {
      deleted_by_name: null,
      transferred_customer_count: null,
      transferred_to_admin_name: null,
      primary_assignees_transferred_count: null,
      collaborator_assignees_removed_count: null,
    });
    assert.deepEqual(parseUserDeletionMetadata("{bad json"), {
      deleted_by_name: null,
      transferred_customer_count: null,
      transferred_to_admin_name: null,
      primary_assignees_transferred_count: null,
      collaborator_assignees_removed_count: null,
    });
  });

  it("maps parsed assignee counts into admin user view fields", () => {
    const parsed = parseUserDeletionMetadata(
      JSON.stringify({
        transferredCustomerCount: 4,
        deletedByName: "Ops Admin",
        transferredToAdminName: "Ops Admin",
        primaryAssigneesTransferredCount: 1,
        collaboratorAssigneesRemovedCount: 2,
      }),
    );

    const viewFields = {
      deleted_by_name: parsed.deleted_by_name,
      transferred_customer_count: parsed.transferred_customer_count,
      transferred_to_admin_name: parsed.transferred_to_admin_name,
      primary_assignees_transferred_count:
        parsed.primary_assignees_transferred_count,
      collaborator_assignees_removed_count:
        parsed.collaborator_assignees_removed_count,
    };

    assert.deepEqual(viewFields, {
      deleted_by_name: "Ops Admin",
      transferred_customer_count: 4,
      transferred_to_admin_name: "Ops Admin",
      primary_assignees_transferred_count: 1,
      collaborator_assignees_removed_count: 2,
    });
  });
});
