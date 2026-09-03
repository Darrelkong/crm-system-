import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  APPROVAL_ATTACHMENTS_METADATA_ERROR_KEY,
  buildOutboundRevisionAttachmentPreviewHref,
  isApprovalDetailReadyForReview,
  isAttachmentBlockingApprovalReview,
  isValidRevisionAttachmentsArray,
  resolveApprovalAttachmentsState,
} from "@/lib/mail/client/mail-approval-review-readiness";
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

function attachmentItem(
  overrides: Partial<ApprovalDetailView["revision"]["attachments"][number]> = {},
) {
  return {
    id: "attachment-1",
    displayFilename: "review-me.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    deliveryMode: "direct_attachment" as const,
    sortOrder: 0,
    downloadAvailable: true,
    ...overrides,
  };
}

describe("approval attachment visibility readiness", () => {
  it("marks valid frozen revision attachments as loaded", () => {
    const revision = detail().revision;
    revision.attachments = [attachmentItem()];
    const state = resolveApprovalAttachmentsState(revision);
    assert.equal(state.state, "loaded");
    assert.equal(state.errorKey, null);
  });

  it("marks invalid attachment metadata as error", () => {
    const revision = detail().revision;
    revision.attachments = [{ id: "bad" }] as ApprovalDetailView["revision"]["attachments"];
    const state = resolveApprovalAttachmentsState(revision);
    assert.equal(state.state, "error");
    assert.equal(state.errorKey, APPROVAL_ATTACHMENTS_METADATA_ERROR_KEY);
  });

  it("allows approve when there are zero attachments", () => {
    assert.equal(
      isApprovalDetailReadyForReview({
        detail: detail(),
        attachmentsLoadState: "loaded",
        attachmentsLoadError: null,
      }),
      true,
    );
  });

  it("blocks approve when any attachment is not downloadAvailable", () => {
    const blocked = detail({
      revision: {
        ...detail().revision,
        attachments: [
          attachmentItem(),
          attachmentItem({
            id: "attachment-2",
            deliveryMode: "secure_file",
            downloadAvailable: false,
          }),
        ],
      },
    });
    assert.equal(
      isApprovalDetailReadyForReview({
        detail: blocked,
        attachmentsLoadState: "loaded",
        attachmentsLoadError: null,
      }),
      false,
    );
    assert.equal(
      isAttachmentBlockingApprovalReview({
        detail: blocked,
        attachmentsLoadState: "loaded",
        attachmentsLoadError: null,
      }),
      true,
    );
  });

  it("blocks approve when attachment metadata failed to load", () => {
    assert.equal(
      isApprovalDetailReadyForReview({
        detail: detail(),
        attachmentsLoadState: "error",
        attachmentsLoadError: APPROVAL_ATTACHMENTS_METADATA_ERROR_KEY,
      }),
      false,
    );
  });

  it("allows approve when all attachments are downloadAvailable", () => {
    const ready = detail({
      revision: {
        ...detail().revision,
        attachments: [attachmentItem(), attachmentItem({ id: "attachment-2" })],
      },
    });
    assert.equal(
      isApprovalDetailReadyForReview({
        detail: ready,
        attachmentsLoadState: "loaded",
        attachmentsLoadError: null,
      }),
      true,
    );
  });
});

describe("approval detail attachment UI wiring", () => {
  it("renders frozen attachment metadata and download action", () => {
    const source = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );
    const route = readFileSync(
      "src/app/api/mail/outbound-revisions/[id]/attachments/[attachmentId]/download/route.ts",
      "utf8",
    );
    assert.match(source, /MailApprovalFrozenAttachmentSection/);
    assert.match(source, /displayFilename/);
    assert.match(source, /formatAttachmentSize/);
    assert.match(source, /formatAttachmentMimeLabel/);
    assert.match(source, /buildOutboundRevisionAttachmentDownloadHref/);
    assert.match(source, /MailAttachmentViewer/);
    assert.match(source, /resolveMailAttachmentPreviewType/);
    assert.match(source, /buildOutboundRevisionAttachmentPreviewHref/);
    assert.match(route, /resolveMailAttachmentPreviewContentType/);
    assert.match(route, /disposition must be inline or attachment/);
    assert.match(source, /mail\.attachment\.downloadUnavailable/);
    assert.match(source, /mail\.approval\.attachmentReviewBlocked/);
  });

  it("builds an authenticated inline preview URL without changing download URLs", () => {
    assert.equal(
      buildOutboundRevisionAttachmentPreviewHref("revision/1", "attachment/1"),
      "/api/mail/outbound-revisions/revision%2F1/attachments/attachment%2F1/download?disposition=inline",
    );
  });

  it("keeps reject available when attachment review is blocked", () => {
    const source = readFileSync(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
      "utf8",
    );
    const rejectStartButton = source.match(
      /onClick=\{\(\) => setRejecting\(true\)\}[\s\S]{0,120}/,
    );
    assert.ok(rejectStartButton);
    assert.doesNotMatch(rejectStartButton[0]!, /reviewReady/);
    assert.match(source, /disabled=\{!reviewReady \|\| actionPending\}/);
  });

  it("loads frozen revision via currentRevisionId in workspace context", () => {
    const source = readFileSync(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
      "utf8",
    );
    assert.match(source, /fetchOutboundRevision\(\s*approvalResult\.item\.currentRevisionId/);
    assert.match(source, /resolveApprovalAttachmentsState/);
    assert.doesNotMatch(source, /fetchDraft/);
  });
});

describe("approval attachment metadata validation", () => {
  it("rejects non-array attachment metadata", () => {
    assert.equal(isValidRevisionAttachmentsArray(null), false);
    assert.equal(isValidRevisionAttachmentsArray({}), false);
  });

  it("accepts complete frozen revision attachment metadata", () => {
    assert.equal(
      isValidRevisionAttachmentsArray([
        attachmentItem(),
        attachmentItem({
          id: "attachment-2",
          deliveryMode: "secure_file",
          downloadAvailable: false,
        }),
      ]),
      true,
    );
  });
});
