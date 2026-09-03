import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
import type {
  AccessibleMailboxView,
  MailMessageDetailView,
  MailMessageListView,
} from "@/lib/mail/client/mail-read-types";
import {
  adaptAccessibleMailbox,
  adaptProductionCustomerAssociation,
  adaptProductionDetailView,
  adaptProductionDraftListRow,
  adaptProductionListRow,
  canRenderProductionQuotedHtml,
  filterProductionListRows,
  formatProductionRecipientLabel,
  groupProductionRecipientLines,
  isProductionDetailReady,
  isProductionMailReadFolder,
  isPrototypeWorkflowFolder,
  PRODUCTION_MAIL_READ_FOLDERS,
  PRODUCTION_WORKFLOW_FOLDERS,
  resolveMailboxSidebarSections,
  resolveMailReadErrorMessageKey,
  normalizeMailWorkspaceFolder,
  shouldApplyProductionDetailResponse,
  shouldRenderProductionCrmContextPanel,
  shouldRenderPrototypeMessageDetail,
  type MailSidebarMailboxPresentation,
} from "@/lib/mail/client/mail-workspace-ui-adapters";
import { MAIL_CRM_CONTEXT_SAFE_FIELD_KEYS } from "@/lib/mail/crm/mail-crm-context-model";

function listItemFixture(
  overrides: Partial<MailMessageListView> = {},
): MailMessageListView {
  return {
    id: "message-1",
    threadId: "thread-1",
    mailboxId: "mailbox-1",
    direction: "inbound",
    sender: { address: "client@example.com", displayName: "Client Co" },
    subject: "Subject line",
    preview: "Preview text",
    timestamp: "2026-08-23T08:00:00.000Z",
    isUnread: true,
    isImportantPersonal: true,
    hasAttachments: true,
    attachmentCount: 2,
    ...overrides,
  };
}

function mailboxFixture(): AccessibleMailboxView {
  return {
    id: "mailbox-1",
    address: "staff@example.com",
    displayName: "Staff",
    mailboxType: "personal",
    accessMode: "member",
    permissions: { canRead: true, canReply: false, canSend: false },
  };
}

function sidebarMailboxFixture(
  overrides: Partial<MailSidebarMailboxPresentation> & Pick<MailSidebarMailboxPresentation, "id">,
): MailSidebarMailboxPresentation {
  return {
    address: `${overrides.id}@example.com`,
    displayName: overrides.displayName ?? null,
    mailboxType: overrides.mailboxType ?? "personal",
    ...overrides,
  };
}

describe("resolveMailboxSidebarSections", () => {
  it("hides mailbox section for one personal mailbox and zero shared", () => {
    const sections = resolveMailboxSidebarSections([
      sidebarMailboxFixture({
        id: "daniel",
        address: "daniel.hayes@echfronthk.com",
        displayName: "Daniel.Hayes",
        mailboxType: "personal",
      }),
    ]);
    assert.equal(sections.showSection, false);
    assert.equal(sections.sectionLabelKey, null);
    assert.equal(sections.personalMailboxes.length, 1);
    assert.equal(sections.sharedMailboxes.length, 0);
  });

  it("uses neutral Mailboxes label for multiple personal mailboxes", () => {
    const sections = resolveMailboxSidebarSections([
      sidebarMailboxFixture({ id: "a", mailboxType: "personal" }),
      sidebarMailboxFixture({ id: "b", mailboxType: "personal" }),
    ]);
    assert.equal(sections.showSection, true);
    assert.equal(sections.sectionLabelKey, "mail.sidebar.mailboxes");
    assert.equal(sections.personalMailboxes.length, 2);
    assert.equal(sections.sharedMailboxes.length, 0);
  });

  it("uses Shared Mailboxes label for shared-only mailboxes", () => {
    const sections = resolveMailboxSidebarSections([
      sidebarMailboxFixture({ id: "info", mailboxType: "shared", displayName: "Info" }),
    ]);
    assert.equal(sections.showSection, true);
    assert.equal(sections.sectionLabelKey, "mail.sidebar.sharedMailboxes");
    assert.equal(sections.personalMailboxes.length, 0);
    assert.equal(sections.sharedMailboxes.length, 1);
  });

  it("uses neutral Mailboxes label for mixed personal and shared mailboxes", () => {
    const sections = resolveMailboxSidebarSections([
      sidebarMailboxFixture({
        id: "daniel",
        mailboxType: "personal",
        displayName: "Daniel.Hayes",
      }),
      sidebarMailboxFixture({ id: "info", mailboxType: "shared", displayName: "Info" }),
    ]);
    assert.equal(sections.showSection, true);
    assert.equal(sections.sectionLabelKey, "mail.sidebar.mailboxes");
    assert.equal(sections.personalMailboxes.length, 1);
    assert.equal(sections.sharedMailboxes.length, 1);
  });

  it("never classifies Daniel personal mailbox as shared-only section", () => {
    const sections = resolveMailboxSidebarSections([
      sidebarMailboxFixture({
        id: "daniel",
        address: "daniel.hayes@echfronthk.com",
        displayName: "Daniel.Hayes",
        mailboxType: "personal",
      }),
    ]);
    assert.notEqual(sections.sectionLabelKey, "mail.sidebar.sharedMailboxes");
  });
});

describe("mail workspace ui adapters", () => {
  it("maps production list rows to presentation fields", () => {
    const row = adaptProductionListRow(listItemFixture());
    assert.equal(row.fromName, "Client Co");
    assert.equal(row.subject, "Subject line");
    assert.equal(row.preview, "Preview text");
    assert.equal(row.sentAt, "2026-08-23T08:00:00.000Z");
    assert.equal(row.isUnread, true);
    assert.equal(row.isImportant, true);
    assert.equal(row.hasAttachment, true);
  });

  it("falls back to sender address when display name is missing", () => {
    const row = adaptProductionListRow(
      listItemFixture({
        sender: { address: "noreply@example.com", displayName: null },
      }),
    );
    assert.equal(row.fromName, "noreply@example.com");
  });

  it("adapts accessible mailboxes for sidebar presentation", () => {
    const mailbox = adaptAccessibleMailbox(mailboxFixture());
    assert.equal(mailbox.id, "mailbox-1");
    assert.equal(mailbox.address, "staff@example.com");
    assert.equal(mailbox.mailboxType, "personal");
  });

  it("filters production list rows locally by search query", () => {
    const rows = [
      adaptProductionListRow(listItemFixture({ id: "a", subject: "Alpha" })),
      adaptProductionListRow(
        listItemFixture({ id: "b", subject: "Beta", preview: "gamma" }),
      ),
    ];
    assert.deepEqual(filterProductionListRows(rows, "alpha").map((row) => row.id), [
      "a",
    ]);
    assert.deepEqual(filterProductionListRows(rows, "gamma").map((row) => row.id), [
      "b",
    ]);
  });

  it("identifies production-supported folders", () => {
    assert.equal(isProductionMailReadFolder("inbox"), true);
    assert.equal(isProductionMailReadFolder("sent"), true);
    assert.equal(isProductionMailReadFolder("trash"), true);
    assert.equal(isProductionMailReadFolder("drafts"), false);
    assert.equal(isPrototypeWorkflowFolder("drafts"), true);
    assert.equal(isPrototypeWorkflowFolder("inbox"), false);
  });

  it("exposes only inbox, sent, and trash for production folder nav", () => {
    assert.deepEqual(
      PRODUCTION_MAIL_READ_FOLDERS.map((folder) => folder.id),
      ["inbox", "sent", "trash"],
    );
    assert.deepEqual(
      PRODUCTION_WORKFLOW_FOLDERS.map((folder) => folder.id),
      ["drafts"],
    );
  });

  it("falls back legacy approval-folder state to Inbox", () => {
    assert.equal(normalizeMailWorkspaceFolder("pending_approval"), "inbox");
    assert.equal(normalizeMailWorkspaceFolder("sent"), "sent");
  });

  it("maps production draft list rows for drafts folder", () => {
    const row = adaptProductionDraftListRow({
      id: "draft-1",
      authorUserId: "user-1",
      mailboxId: "mailbox-1",
      senderIdentityId: null,
      subject: "Re: Hello",
      bodyText: "Reply body",
      bodyHtml: null,
      hasHtml: false,
      sensitivity: "normal",
      composeMode: "reply",
      replyToMessageId: "message-1",
      autosaveVersion: 1,
      lastSavedAt: "2026-08-23T08:30:00.000Z",
      discardedAt: null,
      createdAt: "2026-08-23T08:00:00.000Z",
      updatedAt: "2026-08-23T08:30:00.000Z",
      toRecipients: [
        {
          id: "recipient-1",
          recipientType: "to",
          address: "daniel@example.com",
          displayName: null,
          sortOrder: 0,
        },
      ],
    });
    assert.equal(row.id, "draft-1");
    assert.equal(row.subject, "Re: Hello");
    assert.equal(row.preview, "Reply body");
    assert.equal(row.draftRecipientSummary, "daniel@example.com");
  });

  it("maps API errors to safe message keys", () => {
    assert.equal(
      resolveMailReadErrorMessageKey(new MailReadApiError(403, "Forbidden", "FORBIDDEN")),
      "mail.status.accessUnavailable",
    );
    assert.equal(
      resolveMailReadErrorMessageKey(new MailReadApiError(500, "Server", "SERVER_ERROR")),
      "common.loadFailed",
    );
    assert.equal(
      resolveMailReadErrorMessageKey(new MailReadApiError(404, "Not found", "NOT_FOUND")),
      "common.loadFailed",
    );
  });

  it("blocks prototype detail rendering in production source", () => {
    assert.equal(shouldRenderPrototypeMessageDetail("prototype"), true);
    assert.equal(shouldRenderPrototypeMessageDetail("production"), false);
  });
});

function detailFixture(
  overrides: Partial<MailMessageDetailView> = {},
): MailMessageDetailView {
  return {
    ...listItemFixture(),
    composeMode: null,
    recipients: [
      {
        recipientType: "to",
        address: "client@example.com",
        displayName: "Client Co",
        sortOrder: 0,
      },
      {
        recipientType: "bcc",
        address: "hidden@example.com",
        displayName: null,
        sortOrder: 0,
      },
    ],
    bodyText: "Plain body",
    bodyHtml: "<p>Sanitized body</p>",
    quotedText: "Quoted plain",
    quotedHtml: "<blockquote>Quoted html</blockquote>",
    receivedAt: "2026-08-23T08:00:00.000Z",
    sentAt: null,
    attachments: [
      {
        id: "attachment-1",
        filename: "invoice.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        deliveryMode: "direct_attachment",
        sortOrder: 0,
        downloadAvailable: true,
        downloadable: true,
        previewable: true,
        previewType: "pdf",
      },
    ],
    thread: {
      id: "thread-1",
      mailboxId: "mailbox-1",
      subjectNormalized: "subject line",
      messageCount: 1,
      latestMessageAt: "2026-08-23T08:00:00.000Z",
    },
    customerAssociation: null,
    ...overrides,
  };
}

describe("production detail adapters", () => {
  it("maps production subject and sender display name", () => {
    const detail = adaptProductionDetailView(detailFixture());
    assert.equal(detail.subject, "Subject line");
    assert.equal(detail.senderName, "Client Co");
    assert.equal(detail.senderAddress, "client@example.com");
  });

  it("falls back to sender address when display name is missing", () => {
    const detail = adaptProductionDetailView(
      detailFixture({
        sender: { address: "noreply@example.com", displayName: null },
      }),
    );
    assert.equal(detail.senderName, "noreply@example.com");
    assert.equal(detail.senderAddress, "noreply@example.com");
  });

  it("maps To/Cc/Bcc recipient groups from API output only", () => {
    const groups = groupProductionRecipientLines(detailFixture());
    assert.deepEqual(groups, [
      {
        type: "to",
        addresses: ["Client Co <client@example.com>"],
      },
      {
        type: "bcc",
        addresses: ["hidden@example.com"],
      },
    ]);
    assert.equal(
      formatProductionRecipientLabel({
        recipientType: "to",
        address: "a@example.com",
        displayName: null,
        sortOrder: 0,
      }),
      "a@example.com",
    );
  });

  it("uses sanitized bodyHtml and bodyText fallback fields", () => {
    const htmlDetail = adaptProductionDetailView(detailFixture());
    assert.equal(htmlDetail.bodyHtml, "<p>Sanitized body</p>");
    assert.equal(htmlDetail.bodyText, "Plain body");

    const textOnly = adaptProductionDetailView(
      detailFixture({ bodyHtml: null, bodyText: "Plain only" }),
    );
    assert.equal(textOnly.bodyHtml, null);
    assert.equal(textOnly.bodyText, "Plain only");
  });

  it("allows quotedHtml only through the sanitized field contract", () => {
    assert.equal(canRenderProductionQuotedHtml("<blockquote>safe</blockquote>"), true);
    assert.equal(canRenderProductionQuotedHtml(null), false);
    const detail = adaptProductionDetailView(detailFixture());
    assert.equal(detail.quotedHtml, "<blockquote>Quoted html</blockquote>");
    assert.equal(detail.quotedText, "Quoted plain");
  });

  it("maps attachment metadata without storage internals", () => {
    const detail = adaptProductionDetailView(detailFixture());
    assert.equal(detail.attachments.length, 1);
    assert.equal(detail.attachments[0]?.filename, "invoice.pdf");
    assert.equal(detail.attachments[0]?.sizeLabel, "2.0 KB");
    assert.equal(detail.attachments[0]?.downloadAvailable, true);
    assert.equal(JSON.stringify(detail.attachments[0]), detail.attachments[0]
      ? JSON.stringify({
          id: "attachment-1",
          filename: "invoice.pdf",
          sizeBytes: 2048,
          mimeType: "application/pdf",
          sizeLabel: "2.0 KB",
          deliveryMode: "direct_attachment",
          downloadAvailable: true,
          downloadable: true,
          previewable: true,
          previewType: "pdf",
        })
      : null);
  });

  it("preserves downloadAvailable=false without exposing scan reasons", () => {
    const detail = adaptProductionDetailView(
      detailFixture({
        attachments: [
          {
            id: "attachment-unavailable",
            filename: "pending.bin",
            mimeType: "application/octet-stream",
            sizeBytes: 512,
            deliveryMode: "direct_attachment",
            sortOrder: 0,
            downloadAvailable: false,
          downloadable: false,
            previewable: false,
            previewType: null,
          },
        ],
      }),
    );
    assert.equal(detail.attachments[0]?.downloadAvailable, false);
    assert.equal(JSON.stringify(detail.attachments[0]).includes("scan"), false);
  });

  it("requires selectedMessage to match selectedMessageId before rendering", () => {
    assert.equal(
      isProductionDetailReady({
        selectedMessageId: "message-a",
        selectedMessage: detailFixture({ id: "message-b" }),
        isLoadingDetail: false,
      }),
      false,
    );
    assert.equal(
      isProductionDetailReady({
        selectedMessageId: "message-1",
        selectedMessage: detailFixture({ id: "message-1" }),
        isLoadingDetail: false,
      }),
      true,
    );
  });

  it("rejects stale detail responses when selection changed", () => {
    assert.equal(
      shouldApplyProductionDetailResponse({
        requestMessageId: "message-a",
        requestSequence: 1,
        activeSequence: 2,
        selectedMessageId: "message-b",
      }),
      false,
    );
    assert.equal(
      shouldApplyProductionDetailResponse({
        requestMessageId: "message-b",
        requestSequence: 2,
        activeSequence: 2,
        selectedMessageId: "message-b",
      }),
      true,
    );
  });
});

describe("production CRM context adapter", () => {
  const safeAssociation = {
    customerId: "22222222-2222-2222-2222-222222222201",
    customerCode: "EF000123",
    name: "Staff A Customer",
    salesStage: "interested",
    ownerName: "Employee A",
    associationType: "auto_match" as const,
  };

  it("maps safe production association fields for the CRM panel", () => {
    const adapted = adaptProductionCustomerAssociation(safeAssociation);
    assert.ok(adapted);
    assert.equal(adapted.name, "Staff A Customer");
    assert.equal(adapted.customerCode, "EF000123");
    assert.equal(adapted.salesStage, "interested");
    assert.equal(adapted.ownerName, "Employee A");
    assert.equal(adapted.associationType, "auto_match");
    assert.deepEqual(Object.keys(adapted).sort(), [
      ...MAIL_CRM_CONTEXT_SAFE_FIELD_KEYS,
    ].sort());
  });

  it("maps manual association type safely", () => {
    const adapted = adaptProductionCustomerAssociation({
      ...safeAssociation,
      associationType: "manual",
    });
    assert.equal(adapted?.associationType, "manual");
  });

  it("returns null for denied/no-match production association", () => {
    assert.equal(adaptProductionCustomerAssociation(null), null);
    assert.equal(adaptProductionCustomerAssociation(undefined), null);
    assert.equal(
      shouldRenderProductionCrmContextPanel(null),
      false,
    );
  });

  it("does not spread forbidden CRM fields into panel props", () => {
    const adapted = adaptProductionCustomerAssociation({
      ...safeAssociation,
      phone: "999",
      email: "hidden@example.com",
      wechatId: "wx",
      notes: "secret",
    } as typeof safeAssociation & {
      phone: string;
      email: string;
      wechatId: string;
      notes: string;
    });
    assert.ok(adapted);
    assert.equal("phone" in adapted, false);
    assert.equal("email" in adapted, false);
    assert.equal("wechatId" in adapted, false);
    assert.equal("notes" in adapted, false);
  });
});
