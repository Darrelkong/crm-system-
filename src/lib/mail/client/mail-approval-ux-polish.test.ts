import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY,
  buildApprovalRequesterUsersById,
  buildApprovalWorkflowRows,
  enrichApprovalRequesterUsers,
  formatApprovalRequesterLabel,
  resolveApprovalRequesterLabel,
  type ApprovalApiItem,
  type OutboundRevisionApiItem,
} from "@/lib/mail/client/approval-workflow-management";

const UUID_REQUESTER_ID = "11111111-1111-1111-1111-111111111102";

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
    requestedByUserId: UUID_REQUESTER_ID,
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
    createdByUserId: UUID_REQUESTER_ID,
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

describe("approval requester presentation", () => {
  it("does not expose raw requester UUID when user lookup is missing", () => {
    const usersById = new Map<
      string,
      { id: string; email: string; name: string; status: "active" }
    >();
    const label = resolveApprovalRequesterLabel(UUID_REQUESTER_ID, usersById);
    assert.equal(label, APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY);
    assert.notEqual(label, UUID_REQUESTER_ID);

    const rows = buildApprovalWorkflowRows(
      [approval()],
      new Map([[revision().id, revision()]]),
      [],
    );
    assert.equal(rows[0]?.submitterLabel, APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY);
    assert.notEqual(rows[0]?.submitterLabel, UUID_REQUESTER_ID);
  });

  it("prefers requester display name when available", () => {
    const usersById = new Map([
      [
        UUID_REQUESTER_ID,
        {
          id: UUID_REQUESTER_ID,
          email: "staff-a@example.com",
          name: "員工 A",
          status: "active" as const,
        },
      ],
    ]);
    assert.equal(
      resolveApprovalRequesterLabel(UUID_REQUESTER_ID, usersById),
      "員工 A",
    );

    const rows = buildApprovalWorkflowRows(
      [approval()],
      new Map([[revision().id, revision()]]),
      [
        {
          id: UUID_REQUESTER_ID,
          email: "staff-a@example.com",
          name: "員工 A",
          status: "active",
        },
      ],
    );
    assert.equal(rows[0]?.submitterLabel, "員工 A");
  });

  it("translates unknown requester fallback labels for display", () => {
    assert.equal(
      formatApprovalRequesterLabel(
        APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY,
        (key) => (key === APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY ? "使用者" : key),
      ),
      "使用者",
    );
    assert.equal(formatApprovalRequesterLabel("員工 A", (key) => key), "員工 A");
  });
});

describe("approval requester user enrichment", () => {
  const staffSessionUser = {
    id: UUID_REQUESTER_ID,
    email: "staff-a@example.com",
    name: "員工 A",
  };

  it("resolves author-scope requester display name from session actor", () => {
    const requesterUsers = enrichApprovalRequesterUsers([], staffSessionUser);
    const usersById = buildApprovalRequesterUsersById([], staffSessionUser);

    const rows = buildApprovalWorkflowRows(
      [approval()],
      new Map([[revision().id, revision()]]),
      requesterUsers,
    );
    assert.equal(rows[0]?.submitterLabel, "員工 A");
    assert.equal(
      resolveApprovalRequesterLabel(UUID_REQUESTER_ID, usersById),
      "員工 A",
    );
  });

  it("resolves reviewer-scope requester display name from admin user list", () => {
    const adminUsers = [
      {
        id: UUID_REQUESTER_ID,
        email: "staff-a@example.com",
        name: "員工 A",
        status: "active" as const,
      },
    ];
    const requesterUsers = enrichApprovalRequesterUsers(adminUsers, {
      id: "admin-1",
      email: "admin@example.com",
      name: "Admin User",
    });

    const rows = buildApprovalWorkflowRows(
      [approval()],
      new Map([[revision().id, revision()]]),
      requesterUsers,
    );
    assert.equal(rows[0]?.submitterLabel, "員工 A");
  });

  it("keeps unknown requester fallback when identity cannot be resolved", () => {
    const usersById = buildApprovalRequesterUsersById([], null);
    assert.equal(
      resolveApprovalRequesterLabel(UUID_REQUESTER_ID, usersById),
      APPROVAL_UNKNOWN_REQUESTER_LABEL_KEY,
    );
  });
});

describe("approval body label i18n wiring", () => {
  it("uses mail.approval.body in approval detail pane", () => {
    const source = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );
    assert.match(source, /t\("mail\.approval\.body"\)/);
    assert.doesNotMatch(source, />\s*Body\s*</);
  });
});

describe("approval staff approval UI wiring", () => {
  it("formats requester labels in approval list rows", () => {
    const source = readFileSync(
      "src/components/mail/approval/mail-approval-list.tsx",
      "utf8",
    );
    assert.match(source, /formatApprovalRequesterLabel\(row\.submitterLabel, t\)/);
  });

  it("formats requester labels in approval detail pane", () => {
    const source = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );
    assert.match(
      source,
      /formatApprovalRequesterLabel\(detail\.requesterLabel, t\)/,
    );
  });

  it("builds detail requester labels without raw UUID fallback", () => {
    const source = readFileSync(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
      "utf8",
    );
    assert.match(source, /resolveApprovalRequesterLabel\(/);
    assert.match(source, /enrichApprovalRequesterUsers\(/);
    assert.match(source, /buildApprovalRequesterUsersById\(/);
    assert.doesNotMatch(source, /\|\|\s*approval\.requestedByUserId/);
  });
});
