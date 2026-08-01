import assert from "node:assert/strict";
import { mock } from "node:test";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logApprovalNotificationFailure } from "./notification-safe";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Notifications Round A1 wiring", () => {
  it("notification service exposes createNotificationOnce with entity natural key", () => {
    const src = read("src/lib/notifications/service.ts");
    assert.match(src, /export async function createNotificationOnce/);
    assert.match(src, /relatedEntityType:\s*string/);
    assert.match(src, /relatedEntityId:\s*string/);
    assert.match(
      src,
      /eq\(schema\.notifications\.userId[\s\S]*eq\(schema\.notifications\.type[\s\S]*eq\(schema\.notifications\.relatedEntityType[\s\S]*eq\(schema\.notifications\.relatedEntityId/,
    );
    assert.match(
      src,
      /orderBy\(\s*asc\(schema\.notifications\.createdAt\),\s*asc\(schema\.notifications\.id\),?\s*\)/,
    );
    const onceFn = src.slice(src.indexOf("export async function createNotificationOnce"));
    assert.doesNotMatch(
      onceFn,
      /eq\(schema\.notifications\.title|eq\(schema\.notifications\.message|eq\(schema\.notifications\.isRead|eq\(schema\.notifications\.createdAt/,
    );
  });

  it("approval pending/applicant notify use once + Set + safe catch", () => {
    const src = read("src/lib/approvals/service.ts");
    const pending = src.slice(
      src.indexOf("async function notifyAdminsPending"),
      src.indexOf("async function notifyApplicant"),
    );
    assert.match(pending, /createNotificationOnce/);
    assert.match(pending, /new Set\(/);
    assert.match(
      pending,
      /try\s*\{[\s\S]*listActiveAdminUsers\(\)[\s\S]*\}\s*catch/,
    );
    assert.match(pending, /logApprovalNotificationFailure/);
    assert.doesNotMatch(pending, /await createNotification\(/);
    // Outer list failure omits recipient; per-recipient catch keeps recipientUserId
    assert.match(
      pending,
      /logApprovalNotificationFailure\(\{\s*approvalId: approval\.id,\s*notificationType: "approval\.pending"/,
    );

    const applicant = src.slice(
      src.indexOf("async function notifyApplicant"),
      src.indexOf("async function reassignOpenTasks"),
    );
    assert.match(applicant, /createNotificationOnce/);
    assert.match(applicant, /try\s*\{/);
    assert.match(applicant, /logApprovalNotificationFailure/);
    // notifyApplicant catch must not wrap CAS / executeApprovedAction
    assert.doesNotMatch(applicant, /executeApprovedAction|extractChanges|status:\s*"approved"/);
  });

  it("approve and reject use status=pending CAS and stop on affected=0", () => {
    const src = read("src/lib/approvals/service.ts");
    const approve = src.slice(
      src.indexOf("export async function approveApprovalRequest"),
      src.indexOf("export async function rejectApprovalRequest"),
    );
    assert.match(
      approve,
      /eq\(schema\.approvals\.id,\s*approvalId\)[\s\S]*eq\(schema\.approvals\.status,\s*"pending"\)/,
    );
    assert.match(approve, /extractChanges/);
    assert.match(approve, /changes === 0/);
    assert.match(approve, /该申请已处理，不能重复审批/);
    assert.ok(
      approve.indexOf("extractChanges") < approve.indexOf("executeApprovedAction"),
    );
    assert.ok(
      approve.indexOf("changes === 0") < approve.indexOf("executeApprovedAction"),
    );
    assert.ok(
      approve.indexOf("executeApprovedAction") < approve.indexOf("writeAuditLog"),
    );
    assert.ok(
      approve.indexOf("writeAuditLog") < approve.indexOf("notifyApplicant"),
    );

    const reject = src.slice(
      src.indexOf("export async function rejectApprovalRequest"),
      src.indexOf("export function approvalErrorResponse"),
    );
    assert.match(
      reject,
      /eq\(schema\.approvals\.id,\s*approvalId\)[\s\S]*eq\(schema\.approvals\.status,\s*"pending"\)/,
    );
    assert.match(reject, /extractChanges/);
    assert.match(reject, /changes === 0/);
    assert.ok(
      reject.indexOf("changes === 0") < reject.indexOf("executeRejectedAction"),
    );
    assert.ok(
      reject.indexOf("executeRejectedAction") < reject.indexOf("writeAuditLog"),
    );
    assert.ok(
      reject.indexOf("writeAuditLog") < reject.indexOf("notifyApplicant"),
    );
  });

  it("assignee pending producer mirrors once + Set + safe catch", () => {
    const src = read("src/lib/customers/assignees-approval.ts");
    const pending = src.slice(
      src.indexOf("async function notifyAdminsAssigneePending"),
      src.indexOf("export async function createCustomerAssigneeUpdateApprovalRequest"),
    );
    assert.match(pending, /createNotificationOnce/);
    assert.match(pending, /new Set\(/);
    assert.match(
      pending,
      /try\s*\{[\s\S]*listActiveAdminUsers\(\)[\s\S]*\}\s*catch/,
    );
    assert.match(pending, /logApprovalNotificationFailure/);
    assert.doesNotMatch(pending, /await createNotification\(/);
  });

  it("customer.transferred and closed_won.approved still use createNotification", () => {
    const src = read("src/lib/approvals/service.ts");
    const action = src.slice(
      src.indexOf("async function executeApprovedAction"),
      src.indexOf("async function executeRejectedAction"),
    );
    assert.match(
      action,
      /await createNotification\(db, \{[\s\S]*?type:\s*"customer\.transferred"/,
    );
    assert.match(
      action,
      /await createNotification\(db, \{[\s\S]*?type:\s*"customer\.closed_won\.approved"/,
    );
    assert.doesNotMatch(action, /createNotificationOnce/);
  });

  it("approve/reject routes do not accept recipient or dedup key from client", () => {
    const approve = read("src/app/api/approvals/[id]/approve/route.ts");
    const reject = read("src/app/api/approvals/[id]/reject/route.ts");
    for (const route of [approve, reject]) {
      assert.match(route, /adminComment/);
      assert.doesNotMatch(route, /recipient|dedup|relatedEntity|userId|notification/i);
      assert.match(route, /requireAdmin/);
    }
  });

  it("href mapping and unread/mark-read / work-items query remain unchanged paths", () => {
    const href = read("src/lib/notifications/queries.ts");
    assert.match(href, /case "approval":\s*\n\s*return "\/approvals"/);
    assert.match(href, /export async function markNotificationRead/);
    assert.match(href, /export async function markAllNotificationsRead/);
    assert.match(href, /export async function listNotificationsForUser/);

    const workItems = read("src/lib/work-items/work-items-round-a.test.ts");
    assert.match(workItems, /work-items Round A wiring/);

    const pendingSecond = read("src/lib/notifications/pending-second-conversion.ts");
    assert.match(pendingSecond, /hasPendingSecondConversionNotification/);
    assert.doesNotMatch(pendingSecond, /createNotificationOnce/);

    const backup = read("src/lib/backup/notifications.ts");
    assert.match(backup, /createNotification/);
    assert.doesNotMatch(backup, /createNotificationOnce/);

    const reclaim = read("src/lib/reclamation/engine.ts");
    assert.match(reclaim, /createNotification/);
    assert.doesNotMatch(reclaim, /createNotificationOnce/);
  });

  it("safe notification failure log omits PII fields", () => {
    const errors: unknown[] = [];
    const restore = mock.method(console, "error", (...args: unknown[]) => {
      errors.push(args);
    });

    logApprovalNotificationFailure({
      approvalId: "appr-1",
      recipientUserId: "user-1",
      notificationType: "approval.pending",
      error: new Error('INSERT INTO notifications ... title="Secret" email=a@b.com'),
    });
    logApprovalNotificationFailure({
      approvalId: "appr-2",
      notificationType: "approval.pending",
      error: new Error("listActiveAdminUsers failed"),
    });

    restore.mock.restore();
    assert.equal(errors.length, 2);
    const withRecipient = JSON.stringify(errors[0]);
    assert.match(withRecipient, /appr-1/);
    assert.match(withRecipient, /user-1/);
    assert.match(withRecipient, /approval\.pending/);
    assert.match(withRecipient, /errorCategory/);
    assert.doesNotMatch(withRecipient, /Secret|a@b\.com|INSERT INTO|title|message|phone|address/i);

    const listFailure = JSON.stringify(errors[1]);
    assert.match(listFailure, /appr-2/);
    assert.doesNotMatch(listFailure, /recipientUserId/);
    assert.doesNotMatch(listFailure, /listActiveAdminUsers failed/);
  });
});
