import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildApprovalWorkflowRows,
  canReviewApprovals,
  canViewApprovalWorkflow,
  formatRevisionRecipientsLabel,
  formatRevisionSenderLabel,
  isRejectReasonValid,
  APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY,
  resolveApprovalWorkflowRowActions,
  resolveLatestReturnReason,
  type ApprovalApiItem,
  type OutboundRevisionApiItem,
} from "@/lib/mail/client/approval-workflow-management";

function approval(
  overrides: Partial<ApprovalApiItem> = {},
): ApprovalApiItem {
  return {
    id: "approval-1",
    revisionChainId: "chain-1",
    status: "pending",
    priority: "normal",
    workflowVersion: 1,
    currentRevisionId: "revision-1",
    currentContentHash: "hash-1",
    currentHashVersion: 1,
    approvedRevisionId: null,
    approvedContentHash: null,
    approvedHashVersion: null,
    requestedByUserId: "user-1",
    requestedAt: "2026-08-22T08:00:00.000Z",
    resolvedByUserId: null,
    resolvedAt: null,
    ...overrides,
  };
}

function revision(
  overrides: Partial<OutboundRevisionApiItem> = {},
): OutboundRevisionApiItem {
  return {
    id: "revision-1",
    revisionChainId: "chain-1",
    revisionNumber: 1,
    parentRevisionId: null,
    sourceDraftId: "draft-1",
    revisionKind: "staff_submit",
    mailboxId: "mailbox-1",
    senderIdentityId: "identity-1",
    fromAddress: "staff@echfronthk.com",
    fromDisplayName: "Staff Sender",
    subject: "Quarterly update",
    bodyText: "Hello",
    bodyHtmlSanitized: null,
    sensitivity: "normal",
    composeMode: "new",
    signatureSnapshotId: "snapshot-1",
    contentHash: "hash-1",
    hashVersion: 1,
    createdAt: "2026-08-22T08:00:00.000Z",
    createdByUserId: "user-1",
    recipients: [
      {
        recipientType: "to",
        address: "client@example.com",
        displayName: null,
        sortOrder: 0,
      },
    ],
    attachments: [],
    ...overrides,
  };
}

describe("approval workflow permissions", () => {
  it("allows workflow view when mail access capability is enabled", () => {
    assert.equal(canViewApprovalWorkflow({ approvalWorkflowView: true }), true);
    assert.equal(canViewApprovalWorkflow({ approvalWorkflowView: false }), false);
  });

  it("gates review actions on approvalReviewManagement", () => {
    assert.equal(canReviewApprovals({ approvalReviewManagement: true }), true);
    assert.equal(canReviewApprovals({ approvalReviewManagement: false }), false);
  });
});

describe("approval workflow row builders", () => {
  it("builds list rows with sender, recipients, subject, and submitter labels", () => {
    const rows = buildApprovalWorkflowRows(
      [approval()],
      new Map([[revision().id, revision()]]),
      [{ id: "user-1", email: "staff@example.com", name: "Staff User", status: "active" }],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.senderLabel, "Staff Sender <staff@echfronthk.com>");
    assert.equal(rows[0]?.recipientsLabel, "client@example.com");
    assert.equal(rows[0]?.subject, "Quarterly update");
    assert.equal(rows[0]?.submitterLabel, "Staff User");
  });

  it("uses unknown requester fallback instead of raw user id for missing users", () => {
    const rows = buildApprovalWorkflowRows(
      [approval({ requestedByUserId: "11111111-1111-1111-1111-111111111102" })],
      new Map([[revision().id, revision()]]),
      [],
    );
    assert.equal(rows[0]?.submitterLabel, APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY);
  });

  it("extracts the latest return reason from approval events", () => {
    const reason = resolveLatestReturnReason([
      {
        id: "event-1",
        eventType: "returned",
        workflowVersion: 2,
        actorUserId: "reviewer-1",
        revisionId: "revision-1",
        contentHash: null,
        hashVersion: null,
        note: "Please fix the greeting.",
        createdAt: "2026-08-22T09:00:00.000Z",
      },
    ]);
    assert.equal(reason, "Please fix the greeting.");
  });
});

describe("resolveApprovalWorkflowRowActions", () => {
  it("shows approve and reject for pending reviewer rows", () => {
    const row = buildApprovalWorkflowRows(
      [approval({ status: "pending" })],
      new Map([[revision().id, revision()]]),
      [],
    )[0]!;
    assert.deepEqual(resolveApprovalWorkflowRowActions(row, true), {
      showApprove: true,
      showReject: true,
      showHistory: false,
    });
  });

  it("hides review actions for staff author rows", () => {
    const row = buildApprovalWorkflowRows(
      [approval({ status: "pending" })],
      new Map([[revision().id, revision()]]),
      [],
    )[0]!;
    assert.deepEqual(resolveApprovalWorkflowRowActions(row, false), {
      showApprove: false,
      showReject: false,
      showHistory: false,
    });
  });

  it("hides approve and reject once a submission is approved", () => {
    const row = buildApprovalWorkflowRows(
      [
        approval({
          status: "approved",
          resolvedByUserId: "reviewer-1",
          events: [
            {
              id: "event-1",
              eventType: "approved",
              workflowVersion: 2,
              actorUserId: "reviewer-1",
              revisionId: "revision-1",
              contentHash: null,
              hashVersion: null,
              note: null,
              createdAt: "2026-08-22T09:00:00.000Z",
            },
          ],
        }),
      ],
      new Map([[revision().id, revision()]]),
      [{ id: "reviewer-1", email: "reviewer@example.com", name: "Reviewer", status: "active" }],
    )[0]!;
    assert.deepEqual(resolveApprovalWorkflowRowActions(row, true), {
      showApprove: false,
      showReject: false,
      showHistory: true,
    });
    assert.equal(row.approverLabel, "Reviewer");
  });
});

describe("approval workflow formatting helpers", () => {
  it("formats sender and recipient labels", () => {
    assert.equal(
      formatRevisionSenderLabel(revision()),
      "Staff Sender <staff@echfronthk.com>",
    );
    assert.equal(formatRevisionRecipientsLabel(revision()), "client@example.com");
    assert.equal(formatRevisionRecipientsLabel(null), "—");
  });

  it("requires a non-empty reject reason", () => {
    assert.equal(isRejectReasonValid(""), false);
    assert.equal(isRejectReasonValid("   "), false);
    assert.equal(isRejectReasonValid("Needs changes"), true);
  });
});

describe("approval workflow UI wiring", () => {
  it("registers the approval section in admin center navigation", () => {
    const navSource = readFileSync(
      "src/components/mail/admin/mail-admin-center-nav.tsx",
      "utf8",
    );
    assert.match(navSource, /approval: "mail\.adminCenter\.sections\.approval"/);
  });

  it("renders ApprovalWorkflowManagement in the section panel", () => {
    const panelSource = readFileSync(
      "src/components/mail/admin/mail-admin-center-section-panel.tsx",
      "utf8",
    );
    assert.match(panelSource, /section === "approval"/);
    assert.match(panelSource, /<ApprovalWorkflowManagement \/>/);
  });
});
