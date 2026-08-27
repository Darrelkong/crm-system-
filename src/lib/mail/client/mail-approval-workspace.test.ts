import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isApprovalDetailReadyForReview } from "@/lib/mail/client/mail-approval-workspace-context";
import type { ApprovalDetailView } from "@/lib/mail/client/mail-approval-workspace-context";

function detail(
  overrides: Partial<ApprovalDetailView> = {},
): ApprovalDetailView {
  return {
    approval: {
      id: "approval-1",
      revisionChainId: "chain-1",
      status: "pending",
      priority: "normal",
      workflowVersion: 1,
      currentRevisionId: "revision-1",
      currentContentHash: "hash",
      currentHashVersion: 1,
      approvedRevisionId: null,
      approvedContentHash: null,
      approvedHashVersion: null,
      requestedByUserId: "user-1",
      requestedAt: "2026-08-27T12:00:00.000Z",
      resolvedByUserId: null,
      resolvedAt: null,
    },
    revision: {
      id: "revision-1",
      revisionChainId: "chain-1",
      revisionNumber: 1,
      parentRevisionId: null,
      sourceDraftId: "draft-1",
      revisionKind: "staff_submit",
      mailboxId: "mailbox-1",
      senderIdentityId: "identity-1",
      fromAddress: "daniel.hayes@echfronthk.com",
      fromDisplayName: "Daniel.Hayes",
      subject: "Re: Test",
      bodyText: "Reply body",
      bodyHtmlSanitized: "<p>Reply body</p>",
      sensitivity: "normal",
      composeMode: "reply",
      signatureSnapshotId: "sig-1",
      contentHash: "hash",
      hashVersion: 1,
      createdAt: "2026-08-27T12:00:00.000Z",
      createdByUserId: "user-1",
      recipients: [
        {
          recipientType: "to",
          address: "customer@example.com",
          displayName: null,
          sortOrder: 0,
        },
      ],
      attachments: [],
    },
    requesterLabel: "Daniel.Hayes",
    editableBodyHtml: "<p>Reply body</p>",
    quotedBodyHtml: "<p>On date wrote:</p>",
    ...overrides,
  };
}

describe("mail approval workspace review readiness", () => {
  it("requires loaded detail before enabling approval actions", () => {
    assert.equal(
      isApprovalDetailReadyForReview({
        detail: null,
        attachmentsLoadState: "idle",
        attachmentsLoadError: null,
      }),
      false,
    );
    assert.equal(
      isApprovalDetailReadyForReview({
        detail: detail(),
        attachmentsLoadState: "loaded",
        attachmentsLoadError: null,
      }),
      true,
    );
    assert.equal(
      isApprovalDetailReadyForReview({
        detail: detail({
          revision: {
            ...detail().revision,
            recipients: [],
          },
        }),
        attachmentsLoadState: "loaded",
        attachmentsLoadError: null,
      }),
      false,
    );
    assert.equal(
      isApprovalDetailReadyForReview({
        detail: detail(),
        attachmentsLoadState: "loading",
        attachmentsLoadError: null,
      }),
      false,
    );
  });
});
