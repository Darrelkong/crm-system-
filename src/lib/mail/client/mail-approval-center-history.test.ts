import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  filterApprovalHistoryRows,
  resolveApprovalHistoryResult,
  type ApprovalWorkflowRow,
} from "@/lib/mail/client/approval-workflow-management";

function row(status: ApprovalWorkflowRow["status"]): ApprovalWorkflowRow {
  return {
    id: status,
    status,
    priority: "normal",
    workflowVersion: 2,
    senderLabel: "Daniel Hayes <daniel@example.com>",
    recipientsLabel: "client@example.com",
    subject: "Customer Documents",
    submittedAt: "2026-09-03T10:00:00.000Z",
    reviewedAt: status === "pending" ? null : "2026-09-03T10:10:00.000Z",
    submitterLabel: "Rowan Lei",
    approverLabel: status === "pending" ? "—" : "Daniel Hayes",
    returnReason: status === "returned" ? "Attachment incomplete" : null,
    events: [],
  };
}

describe("Mail Approval Center history semantics", () => {
  it("maps returned approvals to the product-facing rejected result", () => {
    assert.equal(resolveApprovalHistoryResult("returned"), "rejected");
    assert.equal(resolveApprovalHistoryResult("approved"), "approved");
    assert.equal(resolveApprovalHistoryResult("withdrawn"), "withdrawn");
    assert.equal(resolveApprovalHistoryResult("pending"), null);
  });

  it("keeps approved and rejected records while excluding pending records", () => {
    const history = filterApprovalHistoryRows(
      [row("pending"), row("approved"), row("returned"), row("withdrawn")],
      "all",
    );
    assert.deepEqual(
      history.map((item) => item.status),
      ["approved", "returned", "withdrawn"],
    );
  });

  it("supports approved and rejected history filters", () => {
    const rows = [row("approved"), row("returned"), row("withdrawn")];
    assert.deepEqual(
      filterApprovalHistoryRows(rows, "approved").map((item) => item.status),
      ["approved"],
    );
    assert.deepEqual(
      filterApprovalHistoryRows(rows, "rejected").map((item) => item.status),
      ["returned"],
    );
  });

  it("keeps reviewer, review time, and return reason in the history row model", () => {
    const rejected = row("returned");
    assert.equal(rejected.approverLabel, "Daniel Hayes");
    assert.equal(rejected.reviewedAt, "2026-09-03T10:10:00.000Z");
    assert.equal(rejected.returnReason, "Attachment incomplete");
  });
});

describe("Mail Approval Center UI wiring", () => {
  it("gates the independent entry and its badge on the existing review capability", () => {
    const shell = readFileSync(
      "src/components/mail/prototype/mail-prototype-shell.tsx",
      "utf8",
    );
    const entry = readFileSync(
      "src/components/mail/approval/mail-approval-entry-button.tsx",
      "utf8",
    );
    assert.match(shell, /canReviewApprovals\(capabilities\)/);
    assert.match(shell, /MailApprovalCenterWorkspace/);
    assert.match(entry, /ClipboardCheck/);
    assert.match(entry, /pendingCount > 0/);
  });

  it("uses the existing workspace detail and hides actions for reviewed records", () => {
    const center = readFileSync(
      "src/components/mail/approval/mail-approval-center-workspace.tsx",
      "utf8",
    );
    const detail = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );
    assert.match(center, /MailApprovalList/);
    assert.match(center, /MailApprovalDetailPane/);
    assert.match(center, /pendingTab/);
    assert.match(center, /historyTab/);
    assert.match(detail, /showActions = canReview && approval\.status === "pending"/);
    assert.match(detail, /resolveLatestReturnReason/);
  });

  it("keeps the mobile folder popover intrinsic for short menus and bounded for long menus", () => {
    const popover = readFileSync(
      "src/components/mail/prototype/mail-folder-popover.tsx",
      "utf8",
    );
    assert.match(popover, /min\(75dvh/);
    assert.match(popover, /6rem/);
    assert.match(popover, /overflow-y-auto/);
  });
});
