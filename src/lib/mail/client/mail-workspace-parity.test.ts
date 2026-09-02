import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
import type {
  AccessibleMailboxView,
  MailMessageDetailView,
  MailMessageListView,
  MailReadStateView,
} from "@/lib/mail/client/mail-read-types";
import {
  adaptProductionDetailView,
  isProductionDetailReady,
  resolveProductionListEmptyState,
  shouldRenderPrototypeMessageDetail,
} from "@/lib/mail/client/mail-workspace-ui-adapters";
import {
  createMailWorkspaceRuntime,
  mergeMessagePage,
  shouldApplyMessagesResponse,
  type MailWorkspaceApi,
} from "@/lib/mail/client/mail-workspace-context";

function mailboxFixture(
  overrides: Partial<AccessibleMailboxView> = {},
): AccessibleMailboxView {
  return {
    id: "mailbox-1",
    address: "staff@example.com",
    displayName: "Staff",
    mailboxType: "personal",
    accessMode: "member",
    permissions: { canRead: true, canReply: false, canSend: false },
    ...overrides,
  };
}

function listItemFixture(
  overrides: Partial<MailMessageListView> = {},
): MailMessageListView {
  return {
    id: "message-1",
    threadId: "thread-1",
    mailboxId: "mailbox-1",
    direction: "inbound",
    sender: { address: "client@example.com", displayName: "Client" },
    subject: "Hello",
    preview: "Preview",
    timestamp: "2026-08-23T08:00:00.000Z",
    isUnread: true,
    isImportantPersonal: false,
    hasAttachments: false,
    attachmentCount: 0,
    ...overrides,
  };
}

function detailFixture(
  overrides: Partial<MailMessageDetailView> = {},
): MailMessageDetailView {
  return {
    ...listItemFixture(),
    composeMode: null,
    recipients: [],
    bodyText: "Body",
    bodyHtml: "<p>Body</p>",
    quotedText: null,
    quotedHtml: null,
    receivedAt: "2026-08-23T08:00:00.000Z",
    sentAt: null,
    attachments: [],
    thread: {
      id: "thread-1",
      mailboxId: "mailbox-1",
      subjectNormalized: "hello",
      messageCount: 1,
      latestMessageAt: "2026-08-23T08:00:00.000Z",
    },
    customerAssociation: null,
    ...overrides,
  };
}

function createApiMock(overrides: Partial<MailWorkspaceApi> = {}): MailWorkspaceApi {
  return {
    fetchAccessibleMailboxes: async () => [mailboxFixture()],
    fetchMessages: async (input) => ({
      items: [
        listItemFixture({
          id: `message-${input.mailboxId}-${input.folder}${input.cursor ? "-page-2" : ""}`,
          mailboxId: input.mailboxId,
        }),
      ],
      nextCursor: input.cursor ? null : "cursor-1",
    }),
    fetchMessageDetail: async (input) =>
      detailFixture({ id: input.messageId, bodyText: `Body for ${input.messageId}` }),
    updateMessageReadState: async (input) => ({
      messageId: input.messageId,
      isRead: input.patch.isRead ?? false,
      isImportantPersonal: false,
      readAt: input.patch.isRead ? "2026-08-23T09:00:00.000Z" : null,
    }),
    fetchDrafts: async () => [],
    ...overrides,
  };
}

describe("production read parity hardening", () => {
  it("discards stale mailbox A response after mailbox B selection", async () => {
    const api = createApiMock({
      fetchMessages: async (input) => {
        if (input.mailboxId === "mailbox-a") {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            items: [listItemFixture({ id: "stale-a", mailboxId: "mailbox-a" })],
            nextCursor: null,
          };
        }
        return {
          items: [listItemFixture({ id: "fresh-b", mailboxId: "mailbox-b" })],
          nextCursor: null,
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    const first = runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-a",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-b",
      folder: "inbox",
      reset: true,
    });
    await first;
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMailboxId, "mailbox-b");
    assert.equal(snapshot.messages[0]?.id, "fresh-b");
  });

  it("discards stale inbox response after sent selection", async () => {
    const api = createApiMock({
      fetchMessages: async (input) => {
        if (input.folder === "inbox") {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            items: [listItemFixture({ id: "stale-inbox" })],
            nextCursor: null,
          };
        }
        return {
          items: [listItemFixture({ id: "fresh-sent" })],
          nextCursor: null,
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    const first = runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectFolder("sent");
    await first;
    assert.equal(runtime.getSnapshot().selectedFolder, "sent");
    assert.equal(runtime.getSnapshot().messages[0]?.id, "fresh-sent");
  });

  it("discards stale sent response after trash selection", async () => {
    const api = createApiMock({
      fetchMessages: async (input) => {
        if (input.folder === "sent") {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            items: [listItemFixture({ id: "stale-sent" })],
            nextCursor: null,
          };
        }
        return {
          items: [listItemFixture({ id: "fresh-trash" })],
          nextCursor: null,
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    const first = runtime.getSnapshot().selectFolder("sent");
    await runtime.getSnapshot().selectFolder("trash");
    await first;
    assert.equal(runtime.getSnapshot().selectedFolder, "trash");
    assert.equal(runtime.getSnapshot().messages[0]?.id, "fresh-trash");
  });

  it("mailbox change clears previous message selection", async () => {
    const runtime = createMailWorkspaceRuntime(createApiMock());
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-mailbox-1-inbox");
    await runtime.getSnapshot().selectMailbox("mailbox-2");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMessageId, null);
    assert.equal(snapshot.selectedMessage, null);
  });

  it("folder change clears previous message selection", async () => {
    const runtime = createMailWorkspaceRuntime(createApiMock());
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-mailbox-1-inbox");
    await runtime.getSnapshot().selectFolder("sent");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMessageId, null);
    assert.equal(snapshot.selectedMessage, null);
  });

  it("refresh preserves current mailbox and folder", async () => {
    const api = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "sent",
      reset: true,
    });
    await runtime.getSnapshot().refreshMessages();
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMailboxId, "mailbox-1");
    assert.equal(snapshot.selectedFolder, "sent");
  });

  it("pagination append deduplicates IDs", () => {
    const merged = mergeMessagePage(
      [listItemFixture({ id: "message-1" })],
      {
        items: [
          listItemFixture({ id: "message-1" }),
          listItemFixture({ id: "message-2" }),
        ],
        nextCursor: null,
      },
      false,
    );
    assert.deepEqual(
      merged.map((message) => message.id),
      ["message-1", "message-2"],
    );
  });

  it("load-more failure preserves previously loaded page", async () => {
    const api = createApiMock({
      fetchMessages: async (input) => {
        if (input.cursor) {
          throw new MailReadApiError(500, "Server", "SERVER_ERROR");
        }
        return {
          items: [listItemFixture({ id: "message-1" })],
          nextCursor: "cursor-1",
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().loadMoreMessages();
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.messages[0]?.id, "message-1");
  });

  it("shouldApplyMessagesResponse rejects stale mailbox/folder context", () => {
    assert.equal(
      shouldApplyMessagesResponse({
        requestSequence: 1,
        activeSequence: 2,
        request: { mailboxId: "mailbox-a", folder: "inbox" },
        currentMailboxId: "mailbox-b",
        currentFolder: "inbox",
      }),
      false,
    );
    assert.equal(
      shouldApplyMessagesResponse({
        requestSequence: 2,
        activeSequence: 2,
        request: { mailboxId: "mailbox-b", folder: "sent" },
        currentMailboxId: "mailbox-b",
        currentFolder: "sent",
      }),
      true,
    );
  });

  it("zero accessible mailboxes leaves production messages empty", async () => {
    const runtime = createMailWorkspaceRuntime(
      createApiMock({
        fetchAccessibleMailboxes: async () => [],
      }),
    );
    await runtime.getSnapshot().loadMailboxes();
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.mailboxes.length, 0);
    assert.equal(snapshot.messages.length, 0);
  });

  it("maps empty inbox to folder-empty state", () => {
    assert.equal(
      resolveProductionListEmptyState({
        isLoadingMessages: false,
        loadedRowCount: 0,
        filteredRowCount: 0,
        searchQuery: "",
        hasError: false,
      }),
      "folder-empty",
    );
  });

  it("maps search zero-result to search-empty state", () => {
    assert.equal(
      resolveProductionListEmptyState({
        isLoadingMessages: false,
        loadedRowCount: 3,
        filteredRowCount: 0,
        searchQuery: "missing",
        hasError: false,
      }),
      "search-empty",
    );
  });

  it("maps initial list loading to loading state", () => {
    assert.equal(
      resolveProductionListEmptyState({
        isLoadingMessages: true,
        loadedRowCount: 0,
        filteredRowCount: 0,
        searchQuery: "",
        hasError: false,
      }),
      "loading",
    );
  });

  it("maps list API error with no rows to error state", () => {
    assert.equal(
      resolveProductionListEmptyState({
        isLoadingMessages: false,
        loadedRowCount: 0,
        filteredRowCount: 0,
        searchQuery: "",
        hasError: true,
      }),
      "error",
    );
  });

  it("updates unread production row after successful read mutation", async () => {
    const runtime = createMailWorkspaceRuntime(createApiMock());
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().markMessageRead({
      messageId: "message-mailbox-1-inbox",
      isRead: true,
    });
    assert.equal(runtime.getSnapshot().messages[0]?.isUnread, false);
  });

  it("read-state API failure does not corrupt list state", async () => {
    const api = createApiMock({
      updateMessageReadState: async () => {
        throw new MailReadApiError(500, "Server", "SERVER_ERROR");
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().markMessageRead({
      messageId: "message-mailbox-1-inbox",
      isRead: true,
    });
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.messages[0]?.isUnread, true);
    assert.equal(snapshot.error, null);
  });

  it("production attachment presentation contains no storage internals", () => {
    const detail = adaptProductionDetailView(
      detailFixture({
        attachments: [
          {
            id: "attachment-1",
            filename: "invoice.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            deliveryMode: "direct_attachment",
            sortOrder: 0,
            downloadAvailable: true,
            downloadable: true,
            previewable: true,
            previewType: "pdf",
          },
        ],
      }),
    );
    const serialized = JSON.stringify(detail.attachments[0]);
    assert.equal(serialized.includes("storage"), false);
    assert.equal(serialized.includes("storedFile"), false);
    assert.equal(serialized.includes("r2"), false);
  });

  it("production detail readiness still rejects stale ID", () => {
    assert.equal(
      isProductionDetailReady({
        selectedMessageId: "message-a",
        selectedMessage: detailFixture({ id: "message-b" }),
        isLoadingDetail: false,
      }),
      false,
    );
  });

  it("prototype source keeps prototype detail rendering enabled", () => {
    assert.equal(shouldRenderPrototypeMessageDetail("prototype"), true);
    assert.equal(shouldRenderPrototypeMessageDetail("production"), false);
  });
});
