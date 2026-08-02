import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  TASK_CANCEL_REASON,
  buildTaskCancelAuditFields,
} from "@/lib/tasks/lifecycle";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("tasks Round B1-B lifecycle cancel wiring", () => {
  it("exposes customer-scoped cancel helper without type/assignee filters", () => {
    const src = read("src/lib/tasks/lifecycle.ts");
    const cancelFn = src.slice(
      src.indexOf("export function buildCancelOpenTasksForCustomerStatement"),
      src.indexOf("export async function cancelOpenTasksForCustomer"),
    );
    assert.match(src, /export function buildCancelOpenTasksForCustomerStatement/);
    assert.match(cancelFn, /eq\(schema\.tasks\.customerId, customerId\)/);
    assert.match(cancelFn, /eq\(schema\.tasks\.status, "open"\)/);
    assert.match(cancelFn, /status:\s*"cancelled"/);
    assert.doesNotMatch(cancelFn, /inArray\(schema\.tasks\.type/);
    assert.doesNotMatch(cancelFn, /eq\(schema\.tasks\.assignedTo/);
    assert.doesNotMatch(cancelFn, /taskIds|task_ids/);
    assert.doesNotMatch(cancelFn, /count\(|countOpenTasksForCustomer|cancelledOpenTaskCount/);
    assert.doesNotMatch(cancelFn, /title|phone|email|customerName/);
    assert.match(src, /pool_release/);
    assert.match(src, /soft_archive/);
  });

  it("audit helper only returns reason code without estimated counts", () => {
    assert.deepEqual(buildTaskCancelAuditFields(TASK_CANCEL_REASON.poolRelease), {
      taskCancelReasonCode: "pool_release",
    });
    assert.deepEqual(buildTaskCancelAuditFields(TASK_CANCEL_REASON.softArchive), {
      taskCancelReasonCode: "soft_archive",
    });
  });

  it("manual pool release cancels open tasks in the same db.batch", () => {
    const src = read("src/lib/public-pool/service.ts");
    assert.match(src, /buildCancelOpenTasksForCustomerStatement/);
    assert.doesNotMatch(src, /countOpenTasksForCustomer|cancelledOpenTaskCount/);
    assert.match(
      src,
      /db\.batch\(\[[\s\S]*?buildCancelOpenTasksForCustomerStatement\([\s\S]*?\]/,
    );
    assert.match(src, /TASK_CANCEL_REASON\.poolRelease/);
    assert.match(src, /buildTaskCancelAuditFields/);
    assert.doesNotMatch(src, /createNotification/);
    assert.match(src, /delete\(schema\.customerAssignees\)/);
    assert.match(src, /status:\s*"public_pool"/);
    assert.match(src, /releasedBy:\s*user\.id/);
  });

  it("admin soft archive cancels open tasks in the same db.batch", () => {
    const src = read("src/lib/recycle-bin/archive-customer.ts");
    assert.match(src, /buildCancelOpenTasksForCustomerStatement/);
    assert.doesNotMatch(src, /countOpenTasksForCustomer|cancelledOpenTaskCount/);
    assert.match(
      src,
      /db\.batch\(\[[\s\S]*?status:\s*"archived"[\s\S]*?buildCancelOpenTasksForCustomerStatement/,
    );
    assert.match(src, /TASK_CANCEL_REASON\.softArchive/);
    assert.match(src, /customer\.deleted\.soft/);
    assert.doesNotMatch(src, /task\.cancelled\.soft_archive/);
  });

  it("approval delete_customer cancels only on approved archive path", () => {
    const src = read("src/lib/approvals/service.ts");
    const deleteCase = src.slice(
      src.indexOf('case "delete_customer"'),
      src.indexOf('case "transfer_customer"'),
    );
    assert.match(deleteCase, /buildCancelOpenTasksForCustomerStatement/);
    assert.doesNotMatch(deleteCase, /countOpenTasksForCustomer|cancelledOpenTaskCount/);
    assert.match(
      deleteCase,
      /db\.batch\(\[[\s\S]*?status:\s*"archived"[\s\S]*?buildCancelOpenTasksForCustomerStatement/,
    );
    assert.match(deleteCase, /TASK_CANCEL_REASON\.softArchive/);
    assert.match(deleteCase, /APPROVAL_AUDIT_ACTIONS\.customerDeletedSoft/);

    const createFn = src.slice(
      src.indexOf("export async function createApprovalRequest"),
      src.indexOf("export async function approveApprovalRequest"),
    );
    const rejectFn = src.slice(
      src.indexOf("export async function rejectApprovalRequest"),
    );
    assert.doesNotMatch(createFn, /buildCancelOpenTasksForCustomerStatement/);
    assert.doesNotMatch(rejectFn, /buildCancelOpenTasksForCustomerStatement/);

    const transferCase = src.slice(
      src.indexOf('case "transfer_customer"'),
      src.indexOf('case "merge_customers"'),
    );
    assert.doesNotMatch(transferCase, /buildCancelOpenTasksForCustomerStatement/);
    assert.match(transferCase, /reassignOpenTasks/);

    const mergeCase = src.slice(
      src.indexOf('case "merge_customers"'),
      src.indexOf('case "closed_won"'),
    );
    assert.doesNotMatch(mergeCase, /buildCancelOpenTasksForCustomerStatement/);

    const closedWonCase = src.slice(
      src.indexOf('case "closed_won"'),
      src.indexOf('case "second_conversion"'),
    );
    assert.doesNotMatch(closedWonCase, /buildCancelOpenTasksForCustomerStatement/);
  });

  it("permanent delete reuses the same cancel statement semantics", () => {
    const src = read("src/lib/recycle-bin/service.ts");
    assert.match(src, /buildCancelOpenTasksForCustomerStatement/);
    assert.match(
      src,
      /Cancel open tasks before DELETE[\s\S]*?buildCancelOpenTasksForCustomerStatement/,
    );
    assert.match(
      src,
      /buildMarkApprovalNotificationsReadForCustomerStatement[\s\S]*?\.delete\(schema\.approvals\)[\s\S]*?buildCancelOpenTasksForCustomerStatement/,
    );
  });

  it("auto reclaim keeps previousOwner + follow_up/first_contact scope", () => {
    const src = read("src/lib/reclamation/engine.ts");
    assert.match(src, /async function cancelOwnerOpenTasks/);
    assert.match(src, /eq\(schema\.tasks\.assignedTo, previousOwnerId\)/);
    assert.match(
      src,
      /inArray\(schema\.tasks\.type, \["follow_up", "first_contact"\]\)/,
    );
    assert.doesNotMatch(src, /buildCancelOpenTasksForCustomerStatement/);
    assert.doesNotMatch(src, /from "@\/lib\/tasks\/lifecycle"/);
  });

  it("restore does not reopen cancelled tasks", () => {
    const src = read("src/lib/recycle-bin/service.ts");
    const restore = src.slice(
      src.indexOf("restoreCustomerFromRecycleBin"),
      src.indexOf("function assertRecycleBinCustomer"),
    );
    assert.match(restore, /deletedAt:\s*null/);
    assert.doesNotMatch(restore, /schema\.tasks/);
    assert.doesNotMatch(restore, /status:\s*"open"/);
  });

  it("does not change Work Items UI, Dashboard KPI helpers, or complete permission", () => {
    assert.match(
      read("src/lib/permissions/tasks.ts"),
      /assertCanCompleteTask/,
    );
    assert.match(
      read("src/lib/tasks/work-items-query.ts"),
      /eq\(schema\.tasks\.status, "open"\)/,
    );
    assert.doesNotMatch(
      read("src/app/(dashboard)/work-items/work-items-client.tsx"),
      /cancelOpenTasksForCustomer|lifecycle/,
    );
    assert.doesNotMatch(
      read("src/lib/reports/staff-dashboard.ts"),
      /lifecycle|cancelOpenTasks/,
    );
    assert.doesNotMatch(
      read("src/lib/reports/admin-dashboard.ts"),
      /lifecycle|cancelOpenTasks/,
    );
  });

  it("does not modify schema, notifications, or Follow-ups", () => {
    assert.match(
      read("drizzle/schema/tasks.ts"),
      /TASK_STATUSES = \["open", "completed", "cancelled"\]/,
    );
    assert.doesNotMatch(read("src/lib/notifications/service.ts"), /lifecycle/);
    assert.doesNotMatch(
      read("src/lib/follow-ups/safe-return-to.ts"),
      /lifecycle|cancelOpenTasks/,
    );
    const lifecycle = read("src/lib/tasks/lifecycle.ts");
    assert.doesNotMatch(lifecycle, /from "react"|from "lodash"|websocket/i);
  });

  it("Work Items views still exclude cancelled via status=open filters only", () => {
    const q = read("src/lib/tasks/work-items-query.ts");
    assert.match(q, /view === "completed"[\s\S]*?eq\(schema\.tasks\.status, "completed"\)/);
    assert.match(q, /eq\(schema\.tasks\.status, "open"\)/);
    assert.doesNotMatch(q, /status,\s*"cancelled"/);
  });
});
