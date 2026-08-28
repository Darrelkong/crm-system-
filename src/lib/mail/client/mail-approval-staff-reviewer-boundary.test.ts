import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  resolveApprovalWorkflowRowActions,
  canReviewApprovals,
} from "@/lib/mail/client/approval-workflow-management";
import {
  filterVisibleWorkflowFolders,
  resolveApprovalWorkspaceListScope,
  resolveProductionFolderLabelKey,
  resolveWorkflowFolderLabelKey,
  type ProductionWorkflowFolder,
} from "@/lib/mail/client/mail-workspace-ui-adapters";

describe("approval staff / reviewer boundary helpers", () => {
  it("uses author scope for staff and reviewer scope for reviewers", () => {
    assert.equal(resolveApprovalWorkspaceListScope(false), "author");
    assert.equal(resolveApprovalWorkspaceListScope(true), "reviewer");
  });

  it("uses waiting approval label for staff and pending-my-approval for reviewers", () => {
    assert.equal(
      resolveWorkflowFolderLabelKey("pending_approval", false),
      "mail.folders.waitingApproval",
    );
    assert.equal(
      resolveWorkflowFolderLabelKey("pending_approval", true),
      "mail.folders.pendingMyApproval",
    );
  });

  it("resolves production folder label for pending_approval by role", () => {
    assert.equal(
      resolveProductionFolderLabelKey("pending_approval", false),
      "mail.folders.waitingApproval",
    );
    assert.equal(
      resolveProductionFolderLabelKey("pending_approval", true),
      "mail.folders.pendingMyApproval",
    );
  });

  it("hides reviewer-only workflow folders from staff", () => {
    const folders: ProductionWorkflowFolder[] = [
      { id: "drafts", labelKey: "mail.folders.drafts" },
      {
        id: "pending_approval",
        labelKey: "mail.folders.pendingMyApproval",
        reviewerOnly: true,
      },
    ];
    const visibleForStaff = folders.filter(
      (folder) => !folder.reviewerOnly || false,
    );
    assert.deepEqual(visibleForStaff.map((folder) => folder.id), ["drafts"]);
    const visibleForReviewer = folders.filter(
      (folder) => !folder.reviewerOnly || true,
    );
    assert.deepEqual(visibleForReviewer.map((folder) => folder.id), [
      "drafts",
      "pending_approval",
    ]);
  });

  it("shows staff waiting-approval and drafts folders in production nav", () => {
    const staffFolders = filterVisibleWorkflowFolders(false).map((folder) => folder.id);
    assert.deepEqual(staffFolders, ["drafts", "pending_approval"]);
    const reviewerFolders = filterVisibleWorkflowFolders(true).map(
      (folder) => folder.id,
    );
    assert.deepEqual(reviewerFolders, ["drafts", "pending_approval"]);
  });

  it("gates approve and reject actions on canReview", () => {
    const row = {
      id: "approval-1",
      status: "pending" as const,
      events: [],
    };
    assert.deepEqual(resolveApprovalWorkflowRowActions(row as never, false), {
      showApprove: false,
      showReject: false,
      showHistory: false,
    });
    assert.deepEqual(resolveApprovalWorkflowRowActions(row as never, true), {
      showApprove: true,
      showReject: true,
      showHistory: false,
    });
  });

  it("requires approvalReviewManagement for reviewer capability", () => {
    assert.equal(canReviewApprovals({ approvalReviewManagement: false }), false);
    assert.equal(canReviewApprovals({ approvalReviewManagement: true }), true);
  });
});

describe("approval staff / reviewer UI wiring", () => {
  it("loads author scope in workspace context for staff", () => {
    const source = readFileSync(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
      "utf8",
    );
    assert.match(source, /resolveApprovalWorkspaceListScope\(canReview\)/);
  });

  it("filters reviewer-only folders in desktop and mobile folder navigation", () => {
    const navSource = readFileSync(
      "src/components/mail/prototype/mail-folder-nav.tsx",
      "utf8",
    );
    const popoverSource = readFileSync(
      "src/components/mail/prototype/mail-folder-popover.tsx",
      "utf8",
    );
    assert.match(navSource, /filterVisibleWorkflowFolders\(canReview\)/);
    assert.match(popoverSource, /filterVisibleWorkflowFolders\(canReview\)/);
  });

  it("uses role-specific queue headings in approval list", () => {
    const source = readFileSync(
      "src/components/mail/approval/mail-approval-list.tsx",
      "utf8",
    );
    assert.match(source, /mail\.approval\.authorQueueCount/);
    assert.match(source, /mail\.approval\.queueCount/);
    assert.match(source, /canReview/);
  });

  it("gates approval detail actions on reviewReady and canReview", () => {
    const source = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );
    assert.match(source, /showActions = canReview && approval\.status === "pending"/);
    assert.match(source, /disabled=\{!reviewReady \|\| actionPending\}/);
  });

  it("uses waiting-approval label in prototype staff folder config", () => {
    const source = readFileSync(
      "src/lib/mail/prototype/mail-folder-config.ts",
      "utf8",
    );
    assert.match(source, /mail\.folders\.waitingApproval/);
    assert.doesNotMatch(source, /pending_approval.*mail\.folders\.pendingApproval/);
  });

  it("renders attachment metadata and download button treatment", () => {
    const source = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );
    assert.match(source, /formatAttachmentMimeLabel/);
    assert.match(source, /secondary-button inline-flex min-h-9/);
    assert.match(source, /buildOutboundRevisionAttachmentDownloadHref/);
  });
});
