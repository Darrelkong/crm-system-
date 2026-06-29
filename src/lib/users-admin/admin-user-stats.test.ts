import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeAdminUserStats,
  isDeletedAdminUser,
} from "./admin-user-stats";
import type { AdminUserView } from "./types";

function makeUser(overrides: Partial<AdminUserView>): AdminUserView {
  const defaults: AdminUserView = {
    id: "user-1",
    name: "User",
    email: "user@example.com",
    role: "staff",
    status: "active",
    failed_login_count: 0,
    locked_until: null,
    is_locked: false,
    lockout_exempt: false,
    last_failed_login_at: null,
    locked_at: null,
    lock_reason: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    deleted_by_name: null,
    transferred_customer_count: null,
    transferred_to_admin_name: null,
    primary_assignees_transferred_count: null,
    collaborator_assignees_removed_count: null,
    last_login_at: null,
    recent_login_count: 0,
  };

  return { ...defaults, ...overrides };
}

describe("admin user stats", () => {
  it("identifies deleted users by status or deleted_at", () => {
    assert.equal(
      isDeletedAdminUser({ status: "deleted", deleted_at: "2026-01-02" }),
      true,
    );
    assert.equal(
      isDeletedAdminUser({ status: "active", deleted_at: "2026-01-02" }),
      true,
    );
    assert.equal(
      isDeletedAdminUser({ status: "disabled", deleted_at: null }),
      false,
    );
  });

  it("computes total, current, active, deleted, admin, and staff counts", () => {
    const users: AdminUserView[] = [
      makeUser({ id: "admin", role: "admin", status: "active" }),
      makeUser({ id: "staff-a", status: "active" }),
      makeUser({ id: "staff-b", status: "disabled" }),
      makeUser({
        id: "staff-deleted",
        status: "deleted",
        deleted_at: "2026-01-03T00:00:00.000Z",
      }),
    ];

    assert.deepEqual(computeAdminUserStats(users), {
      total: 4,
      current: 3,
      active: 2,
      deleted: 1,
      admins: 1,
      staff: 1,
    });
  });
});
