import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { translate } from "@/i18n/translate";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("tasks Round B1-A staff delete open-task reassignment wiring", () => {
  it("exposes single-statement reassign helper without type or customer filters", () => {
    const src = read("src/lib/tasks/lifecycle.ts");
    assert.match(
      src,
      /export function buildReassignOpenTasksForAssigneeStatement/,
    );
    const reassignFn = src.slice(
      src.indexOf("export function buildReassignOpenTasksForAssigneeStatement"),
      src.indexOf("export function buildTaskCancelAuditFields"),
    );
    assert.match(reassignFn, /eq\(schema\.tasks\.assignedTo, input\.previousAssigneeId\)/);
    assert.match(reassignFn, /eq\(schema\.tasks\.status, "open"\)/);
    assert.match(reassignFn, /assignedTo:\s*input\.nextAssigneeId/);
    assert.match(reassignFn, /updatedAt:\s*input\.updatedAt/);
    assert.doesNotMatch(reassignFn, /inArray\(schema\.tasks\.type|customerId|join\(/i);
    assert.doesNotMatch(reassignFn, /title|description|phone|email|taskIds/);
    assert.doesNotMatch(reassignFn, /status:\s*"cancelled"/);

    const cancelFn = src.slice(
      src.indexOf("export function buildCancelOpenTasksForCustomerStatement"),
      src.indexOf("export async function cancelOpenTasksForCustomer"),
    );
    assert.match(cancelFn, /status:\s*"cancelled"/);
    assert.doesNotMatch(cancelFn, /eq\(schema\.tasks\.assignedTo/);
  });

  it("softDeleteUserAccount batches one task reassignment before user soft delete", () => {
    const src = read("src/lib/users-admin/service.ts");
    const fn = src.slice(
      src.indexOf("export async function softDeleteUserAccount"),
      src.indexOf("export async function resetUserPassword"),
    );
    assert.match(fn, /buildReassignOpenTasksForAssigneeStatement/);
    assert.match(
      fn,
      /appendStaffDeleteAssigneeStatements[\s\S]*?buildReassignOpenTasksForAssigneeStatement[\s\S]*?isActive:\s*0[\s\S]*?deletedAt:\s*now/,
    );
    assert.match(
      fn,
      /buildReassignOpenTasksForAssigneeStatement\([\s\S]*?previousAssigneeId:\s*targetUserId[\s\S]*?nextAssigneeId:\s*actor\.id/,
    );
    assert.match(fn, /taskReassignmentReasonCode:\s*"staff_deleted"/);
    assert.match(fn, /previousAssigneeId:\s*targetUserId/);
    assert.match(fn, /nextAssigneeId:\s*actor\.id/);
    assert.doesNotMatch(fn, /openTasksCount|taskIds|taskCount|transferredTaskCount/);
    assert.doesNotMatch(fn, /createNotification/);
    // Exactly one call site for the reassignment helper in soft-delete.
    assert.equal(
      (fn.match(/buildReassignOpenTasksForAssigneeStatement/g) ?? []).length,
      1,
    );
  });

  it("delete route ignores client body and uses authenticated actor only", () => {
    const route = read("src/app/api/admin/users/[id]/delete/route.ts");
    assert.match(route, /requireUserManagementAdmin/);
    assert.match(route, /softDeleteUserAccount\(actor, id,/);
    assert.doesNotMatch(route, /request\.json|transferTo|nextAssigneeId|taskIds/);
  });

  it("delete modal explains open-task reassignment without receiver input", () => {
    const modal = read("src/components/users/delete-staff-modal.tsx");
    assert.match(modal, /deleteStaffModalOpenTasksReassign/);
    assert.match(modal, /count:\s*String\(preview\.impact\?\.openTasksCount \?\? 0\)/);
    assert.match(modal, /method:\s*"POST"/);
    const confirmFn = modal.slice(
      modal.indexOf("async function handleConfirmDelete"),
      modal.indexOf("function roleLabel"),
    );
    assert.doesNotMatch(confirmFn, /transferTo|nextAssigneeId|taskIds/);
    assert.doesNotMatch(confirmFn, /body:\s*|JSON\.stringify/);
    assert.doesNotMatch(modal, /<select|<input[^>]+name=["']transfer/i);
  });

  it("preview still counts assignedTo + open only", () => {
    const src = read("src/lib/users-admin/delete-preview.ts");
    assert.match(src, /eq\(schema\.tasks\.assignedTo, targetUserId\)/);
    assert.match(src, /eq\(schema\.tasks\.status, "open"\)/);
    assert.doesNotMatch(src, /inArray\(schema\.tasks\.type|customerId/);
  });

  it("three locales interpolate open-task reassignment copy", () => {
    assert.equal(
      translate(zhHans, "employees.deleteStaffModalOpenTasksReassign", {
        count: "0",
      }),
      "未完成任务：0 项。删除后，这些任务将转移给当前执行操作的管理员。",
    );
    assert.equal(
      translate(zhHant, "employees.deleteStaffModalOpenTasksReassign", {
        count: "3",
      }),
      "未完成任務：3 項。刪除後，這些任務將轉移給目前執行操作的管理員。",
    );
    assert.equal(
      translate(en, "employees.deleteStaffModalOpenTasksReassign", {
        count: "2",
      }),
      "Open tasks: 2. After deletion, these tasks will be reassigned to the administrator performing this action.",
    );
  });

  it("does not modify Work Items, Dashboard, Notifications, B1-C1, or Auto reclaim", () => {
    assert.doesNotMatch(
      read("src/lib/tasks/work-items-query.ts"),
      /buildReassignOpenTasksForAssigneeStatement|staff_deleted/,
    );
    assert.doesNotMatch(
      read("src/lib/reports/staff-dashboard.ts"),
      /buildReassignOpenTasksForAssigneeStatement/,
    );
    assert.doesNotMatch(
      read("src/lib/notifications/service.ts"),
      /buildReassignOpenTasksForAssigneeStatement/,
    );
    assert.doesNotMatch(
      read("src/lib/tasks/first-contact.ts"),
      /buildReassignOpenTasksForAssigneeStatement/,
    );
    assert.doesNotMatch(
      read("src/lib/reclamation/engine.ts"),
      /buildReassignOpenTasksForAssigneeStatement/,
    );
    assert.match(
      read("src/lib/tasks/lifecycle.ts"),
      /buildCancelOpenTasksForCustomerStatement/,
    );
  });
});
