import assert from "node:assert/strict";
import { mock } from "node:test";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  logApprovalPendingMarkReadFailure,
  markApprovalPendingNotificationsReadSafely,
} from "./notification-safe";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Notifications Round B1 pending lifecycle wiring", () => {
  it("exposes single-UPDATE markApprovalPendingNotificationsRead without userId", () => {
    const src = read("src/lib/notifications/queries.ts");
    const fn = src.slice(
      src.indexOf("export async function markApprovalPendingNotificationsRead"),
      src.indexOf(
        "export function buildMarkApprovalNotificationsReadForCustomerStatement",
      ),
    );
    assert.match(fn, /eq\(schema\.notifications\.type,\s*"approval\.pending"\)/);
    assert.match(
      fn,
      /eq\(schema\.notifications\.relatedEntityType,\s*"approval"\)/,
    );
    assert.match(fn, /eq\(schema\.notifications\.relatedEntityId,\s*approvalId\)/);
    assert.match(fn, /eq\(schema\.notifications\.isRead,\s*0\)/);
    assert.match(fn, /isRead:\s*1/);
    assert.doesNotMatch(fn, /userId|select\(|\.from\(/);
    assert.doesNotMatch(fn, /title|message|createdAt/);
    assert.match(fn, /markedReadCount/);
  });

  it("safe mark-read swallows errors and logs without PII", () => {
    const src = read("src/lib/approvals/notification-safe.ts");
    assert.match(src, /export async function markApprovalPendingNotificationsReadSafely/);
    assert.match(src, /operation:\s*"mark_pending_read"/);
    assert.match(src, /finalStatus/);
    assert.match(src, /errorCategory/);
    assert.doesNotMatch(src, /stack|title|message|email|phone|customerName/);

    const errors: unknown[] = [];
    const restore = mock.method(console, "error", (...args: unknown[]) => {
      errors.push(args);
    });
    logApprovalPendingMarkReadFailure({
      approvalId: "appr-b1",
      finalStatus: "approved",
      error: new Error('UPDATE notifications SET title="Secret"'),
    });
    restore.mock.restore();
    assert.equal(errors.length, 1);
    const payload = JSON.stringify(errors[0]);
    assert.match(payload, /appr-b1/);
    assert.match(payload, /mark_pending_read/);
    assert.match(payload, /approved/);
    assert.doesNotMatch(payload, /Secret|UPDATE notifications|title|message/i);
  });

  it("approve and reject run mark-read after audit and independently of notifyApplicant", () => {
    const src = read("src/lib/approvals/service.ts");
    const approve = src.slice(
      src.indexOf("export async function approveApprovalRequest"),
      src.indexOf("export async function rejectApprovalRequest"),
    );
    assert.match(approve, /markApprovalPendingNotificationsReadSafely/);
    assert.ok(
      approve.indexOf("executeApprovedAction") <
        approve.indexOf("writeAuditLog"),
    );
    assert.ok(
      approve.indexOf("writeAuditLog") <
        approve.indexOf("markApprovalPendingNotificationsReadSafely"),
    );
    assert.ok(
      approve.indexOf("markApprovalPendingNotificationsReadSafely") <
        approve.indexOf("notifyApplicant"),
    );
    assert.match(
      approve,
      /markApprovalPendingNotificationsReadSafely\(\s*db,\s*approvalId,\s*"approved"/,
    );

    const reject = src.slice(
      src.indexOf("export async function rejectApprovalRequest"),
      src.indexOf("export function approvalErrorResponse"),
    );
    assert.match(reject, /markApprovalPendingNotificationsReadSafely/);
    assert.ok(
      reject.indexOf("executeRejectedAction") <
        reject.indexOf("writeAuditLog"),
    );
    assert.ok(
      reject.indexOf("writeAuditLog") <
        reject.indexOf("markApprovalPendingNotificationsReadSafely"),
    );
    assert.ok(
      reject.indexOf("markApprovalPendingNotificationsReadSafely") <
        reject.indexOf("notifyApplicant"),
    );
    assert.match(
      reject,
      /markApprovalPendingNotificationsReadSafely\(\s*db,\s*approvalId,\s*"rejected"/,
    );

    // Side-effects stay outside CAS / action try boundaries (independent awaits).
    assert.doesNotMatch(
      approve.slice(
        approve.indexOf("markApprovalPendingNotificationsReadSafely"),
        approve.indexOf("notifyApplicant"),
      ),
      /try\s*\{/,
    );
  });

  it("does not change mark-read APIs, Work Items query, or reclaim producers", () => {
    const readRoute = read("src/app/api/notifications/[id]/read/route.ts");
    const readAll = read("src/app/api/notifications/read-all/route.ts");
    assert.match(readRoute, /markNotificationRead/);
    assert.match(readAll, /markAllNotificationsRead/);
    assert.doesNotMatch(readRoute, /markApprovalPendingNotificationsRead/);
    assert.doesNotMatch(readAll, /markApprovalPendingNotificationsRead/);

    const queries = read("src/lib/notifications/queries.ts");
    assert.match(queries, /export async function markNotificationRead/);
    assert.match(queries, /export async function markAllNotificationsRead/);
    assert.match(queries, /export async function listNotificationsForUser/);

    const reclaim = read("src/lib/reclamation/engine.ts");
    assert.doesNotMatch(reclaim, /markApprovalPendingNotificationsRead/);

    const pendingSecond = read(
      "src/lib/notifications/pending-second-conversion.ts",
    );
    assert.doesNotMatch(
      pendingSecond,
      /markApprovalPendingNotificationsRead/,
    );
  });

  it("safe helper never throws when mark-read rejects", async () => {
    const db = {
      update: () => {
        throw new Error("db down");
      },
    } as never;

    await assert.doesNotReject(() =>
      markApprovalPendingNotificationsReadSafely(db, "appr-x", "rejected"),
    );
  });
});
