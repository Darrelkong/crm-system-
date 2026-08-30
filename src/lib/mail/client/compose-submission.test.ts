import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ApprovalApiItem } from "@/lib/mail/client/approval-workflow-management";
import {
  buildSubmissionIssueMessageKey,
  canSubmitComposeForApproval,
  findAuthorApprovalForDraft,
  isAdminDirectSendBlockingResubmit,
  resolveComposeOutboundWorkflow,
  resolveComposeSubmissionPhase,
  resolveComposeSubmitButtonLabelKey,
  resolveComposeSubmittingLabelKey,
  validateComposeForSubmission,
} from "@/lib/mail/client/compose-submission";
import {
  createEmptyComposeState,
  type ComposeContextOption,
} from "@/lib/mail/client/draft-management";

const composeOption: ComposeContextOption = {
  senderIdentityId: "identity-1",
  mailboxId: "mailbox-1",
  address: "staff@example.com",
  displayName: "Staff",
  mailboxAddress: "staff@example.com",
  mailboxDisplayName: null,
  mailboxType: "personal",
};

function validState() {
  return {
    ...createEmptyComposeState(),
    draftId: "draft-1",
    autosaveVersion: 1,
    senderIdentityId: composeOption.senderIdentityId,
    mailboxId: composeOption.mailboxId,
    to: [{ id: "chip-1", email: "client@example.com" }],
    subject: "Quarterly update",
    bodyHtml: "<p>Hello team</p>",
  };
}

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

describe("compose submission validation", () => {
  it("requires from, recipients, subject, and body", () => {
    const result = validateComposeForSubmission(
      createEmptyComposeState(),
      [composeOption],
      null,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.issues.sort(), [
        "BODY_REQUIRED",
        "FROM_REQUIRED",
        "RECIPIENTS_REQUIRED",
        "SUBJECT_REQUIRED",
      ]);
    }
  });

  it("blocks pending-upload attachments and unauthorized From", () => {
    const state = {
      ...validState(),
      senderIdentityId: "identity-2",
      attachments: [
        {
          id: "att-1",
          name: "invoice.pdf",
          sizeLabel: "12 KB",
          sizeBytes: 12 * 1024,
          kind: "attachment" as const,
          pendingUpload: true,
          uploadStatus: "uploading" as const,
          uploadProgress: 50,
          error: null,
        },
      ],
    };
    const result = validateComposeForSubmission(state, [composeOption], null);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues.includes("FROM_UNAUTHORIZED"), true);
      assert.equal(result.issues.includes("ATTACHMENTS_PENDING"), true);
    }
  });

  it("allows submit when validation passes", () => {
    assert.equal(
      canSubmitComposeForApproval(validState(), [composeOption], null),
      true,
    );
  });

  it("blocks resubmission while pending or after approval", () => {
    assert.equal(
      canSubmitComposeForApproval(
        validState(),
        [composeOption],
        approval({ status: "pending" }),
      ),
      false,
    );
    assert.equal(
      canSubmitComposeForApproval(
        validState(),
        [composeOption],
        approval({ status: "approved" }),
      ),
      false,
    );
    assert.equal(
      canSubmitComposeForApproval(
        validState(),
        [composeOption],
        approval({ status: "returned" }),
      ),
      true,
    );
  });
});

describe("compose submission helpers", () => {
  it("finds the latest author approval linked to a draft", () => {
    const older = approval({
      id: "approval-old",
      requestedAt: "2026-08-22T07:00:00.000Z",
      currentRevisionId: "revision-old",
    });
    const newer = approval({
      id: "approval-new",
      requestedAt: "2026-08-22T09:00:00.000Z",
      currentRevisionId: "revision-new",
    });
    const revisionsById = new Map([
      ["revision-old", { sourceDraftId: "draft-1" }],
      ["revision-new", { sourceDraftId: "draft-1" }],
      ["revision-other", { sourceDraftId: "draft-2" }],
    ]);

    assert.equal(
      findAuthorApprovalForDraft("draft-1", [older, newer], revisionsById)?.id,
      "approval-new",
    );
  });

  it("maps validation issues to i18n keys", () => {
    assert.equal(
      buildSubmissionIssueMessageKey("SUBJECT_REQUIRED"),
      "mail.recipient.subjectRequired",
    );
    assert.equal(
      buildSubmissionIssueMessageKey("ATTACHMENTS_PENDING"),
      "mail.compose.validation.attachmentsPending",
    );
  });

  it("derives submission phases for UI rendering", () => {
    assert.equal(
      resolveComposeSubmissionPhase({ submitting: true, approval: null }),
      "submitting",
    );
    assert.equal(
      resolveComposeSubmissionPhase({
        submitting: false,
        approval: approval({ status: "pending" }),
      }),
      "pending_approval",
    );
    assert.equal(
      resolveComposeSubmissionPhase({
        submitting: false,
        approval: approval({ status: "returned" }),
      }),
      "returned",
    );
    assert.equal(
      resolveComposeSubmissionPhase({
        submitting: false,
        approval: null,
        send: {
          id: "send-1",
          outboundRevisionId: "revision-1",
          revisionChainId: "chain-1",
          contentHash: "hash",
          hashVersion: 1,
          revisionKind: "admin_direct",
          authorizationMode: "admin_direct",
          approvalId: null,
          idempotencyKey: "key",
          status: "pending",
          orchestrationVersion: 1,
          initiatedByUserId: "admin",
          createdAt: "2026-08-22T08:00:00.000Z",
          completedAt: null,
          nextAttemptAt: null,
        },
      }),
      "approved",
    );
  });

  it("routes CRM root admin to admin_direct workflow", () => {
    assert.equal(resolveComposeOutboundWorkflow(true), "admin_direct");
    assert.equal(resolveComposeOutboundWorkflow(false), "staff_approved");
  });

  it("uses workflow-aware submitting labels", () => {
    assert.equal(
      resolveComposeSubmittingLabelKey({ workflow: "admin_direct" }),
      "mail.compose.submittingSend",
    );
    assert.equal(
      resolveComposeSubmittingLabelKey({ workflow: "staff_approved" }),
      "mail.compose.submittingApproval",
    );
  });

  it("uses Send label for root admin workflow button", () => {
    assert.equal(
      resolveComposeSubmitButtonLabelKey({
        submitting: false,
        workflow: "admin_direct",
        approvalReturned: false,
      }),
      "mail.compose.send",
    );
    assert.equal(
      resolveComposeSubmitButtonLabelKey({
        submitting: false,
        workflow: "staff_approved",
        approvalReturned: false,
      }),
      "mail.compose.submitApproval",
    );
  });

  it("blocks admin_direct resubmit while send is in flight", () => {
    assert.equal(
      isAdminDirectSendBlockingResubmit({
        id: "send-1",
        outboundRevisionId: "revision-1",
        revisionChainId: "chain-1",
        contentHash: "hash",
        hashVersion: 1,
        revisionKind: "admin_direct",
        authorizationMode: "admin_direct",
        approvalId: null,
        idempotencyKey: "key",
        status: "pending",
        orchestrationVersion: 1,
        initiatedByUserId: "admin",
        createdAt: "2026-08-22T08:00:00.000Z",
        completedAt: null,
        nextAttemptAt: null,
      }),
      true,
    );
    assert.equal(
      canSubmitComposeForApproval(
        validState(),
        [composeOption],
        null,
        {
          id: "send-1",
          outboundRevisionId: "revision-1",
          revisionChainId: "chain-1",
          contentHash: "hash",
          hashVersion: 1,
          revisionKind: "admin_direct",
          authorizationMode: "admin_direct",
          approvalId: null,
          idempotencyKey: "key",
          status: "pending",
          orchestrationVersion: 1,
          initiatedByUserId: "admin",
          createdAt: "2026-08-22T08:00:00.000Z",
          completedAt: null,
          nextAttemptAt: null,
        },
      ),
      false,
    );
  });
});

describe("compose submission wiring", () => {
  it("uses submit-for-approval APIs and shared approval status badge", () => {
    const hook = readFileSync(
      "src/components/mail/compose/use-mail-compose-draft.tsx",
      "utf8",
    );
    const editor = readFileSync(
      "src/components/mail/compose/mail-compose-editor.tsx",
      "utf8",
    );
    const api = readFileSync("src/lib/mail/client/api.ts", "utf8");

    assert.match(hook, /createDraftRevision/);
    assert.match(hook, /createAdminDirectDraftRevision/);
    assert.match(hook, /initiateAdminDirectSend/);
    assert.match(hook, /submitRevisionForApproval/);
    assert.match(hook, /postApprovalResubmit/);
    assert.match(hook, /resolveComposeOutboundWorkflow/);
    assert.match(editor, /resolveComposeSubmitButtonLabelKey/);
    assert.match(editor, /MailComposeSubmissionStatus/);
    assert.match(api, /draftRevisionPath/);
    assert.match(api, /draftAdminDirectRevisionPath/);
    assert.match(api, /sendAdminDirectPath/);
    assert.match(api, /submitRevisionApprovalPath/);
  });
});
