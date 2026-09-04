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
  applyReadStateToMessages,
  createMailWorkspaceRuntime,
  INITIAL_MAIL_WORKSPACE_STATE,
  isSameFolderMessageRefresh,
  mergeMessagePage,
  resolveMailboxMessageLoadFolder,
  type MailWorkspaceApi,
} from "@/lib/mail/client/mail-workspace-context";

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

function detailFixture(): MailMessageDetailView {
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
  };
}

function createApiMock(overrides: Partial<MailWorkspaceApi> = {}): {
  api: MailWorkspaceApi;
  calls: {
    mailboxes: number;
    messages: Array<{ mailboxId: string; folder: string; cursor?: string | null }>;
    details: Array<{ messageId: string; folder?: string }>;
    readStates: Array<{ messageId: string; isRead?: boolean; folder?: string }>;
  };
} {
  const calls = {
    mailboxes: 0,
    messages: [] as Array<{
      mailboxId: string;
      folder: string;
      cursor?: string | null;
    }>,
    details: [] as Array<{ messageId: string; folder?: string }>,
    readStates: [] as Array<{
      messageId: string;
      isRead?: boolean;
      folder?: string;
    }>,
  };

  const api: MailWorkspaceApi = {
    fetchAccessibleMailboxes: async () => {
      calls.mailboxes += 1;
      return [mailboxFixture()];
    },
    fetchMessages: async (input) => {
      calls.messages.push({
        mailboxId: input.mailboxId,
        folder: input.folder,
        cursor: input.cursor,
      });
      if (input.cursor === "cursor-1") {
        return {
          items: [listItemFixture({ id: "message-2" })],
          nextCursor: null,
        };
      }
      return {
        items: [listItemFixture()],
        nextCursor: "cursor-1",
      };
    },
    fetchMessageDetail: async (input) => {
      calls.details.push(input);
      return detailFixture();
    },
    updateMessageReadState: async (input) => {
      calls.readStates.push({
        messageId: input.messageId,
        isRead: input.patch.isRead,
        folder: input.folder,
      });
      const item: MailReadStateView = {
        messageId: input.messageId,
        isRead: input.patch.isRead ?? false,
        isImportantPersonal: input.patch.isImportantPersonal ?? false,
        readAt: input.patch.isRead ? "2026-08-23T09:00:00.000Z" : null,
      };
      return item;
    },
    fetchDrafts: async () => [
      {
        id: "draft-1",
        authorUserId: "user-1",
        mailboxId: "mailbox-1",
        senderIdentityId: null,
        subject: "Draft subject",
        bodyText: "Draft body",
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
      },
    ],
    ...overrides,
  };

  return { api, calls };
}

describe("mail workspace helpers", () => {
  it("maps mailbox switch folders to production message folders only", () => {
    assert.equal(resolveMailboxMessageLoadFolder("inbox"), "inbox");
    assert.equal(resolveMailboxMessageLoadFolder("sent"), "sent");
    assert.equal(resolveMailboxMessageLoadFolder("trash"), "trash");
    assert.equal(resolveMailboxMessageLoadFolder("drafts"), "inbox");
    assert.equal(resolveMailboxMessageLoadFolder("pending_approval"), null);
  });

  it("merges paginated message pages without duplicates", () => {
    const first = [listItemFixture({ id: "message-1" })];
    const second = {
      items: [
        listItemFixture({ id: "message-1" }),
        listItemFixture({ id: "message-2" }),
      ],
      nextCursor: null,
    };
    assert.deepEqual(mergeMessagePage(first, second, false), [
      listItemFixture({ id: "message-1" }),
      listItemFixture({ id: "message-2" }),
    ]);
  });

  it("applies read state to list rows", () => {
    const updated = applyReadStateToMessages([listItemFixture()], {
      messageId: "message-1",
      isRead: true,
      isImportantPersonal: false,
      readAt: "2026-08-23T09:00:00.000Z",
    });
    assert.equal(updated[0]?.isUnread, false);
  });

  it("detects same-folder refresh vs different-folder switch", () => {
    assert.equal(
      isSameFolderMessageRefresh({
        reset: true,
        currentMailboxId: "mailbox-1",
        currentFolder: "inbox",
        targetMailboxId: "mailbox-1",
        targetFolder: "inbox",
      }),
      true,
    );
    assert.equal(
      isSameFolderMessageRefresh({
        reset: true,
        currentMailboxId: "mailbox-1",
        currentFolder: "inbox",
        targetMailboxId: "mailbox-1",
        targetFolder: "sent",
      }),
      false,
    );
  });
});

describe("mail workspace runtime", () => {
  it("initializes with default state", () => {
    const runtime = createMailWorkspaceRuntime(createApiMock().api);
    const snapshot = runtime.getSnapshot();
    assert.deepEqual(
      {
        mailboxes: snapshot.mailboxes,
        selectedMailboxId: snapshot.selectedMailboxId,
        selectedFolder: snapshot.selectedFolder,
        messages: snapshot.messages,
        drafts: snapshot.drafts,
        outboxItems: snapshot.outboxItems,
        selectedMessage: snapshot.selectedMessage,
        selectedMessageId: snapshot.selectedMessageId,
        nextCursor: snapshot.nextCursor,
        isLoadingMailboxes: snapshot.isLoadingMailboxes,
        isLoadingMessages: snapshot.isLoadingMessages,
        isLoadingDetail: snapshot.isLoadingDetail,
        isLoadingOutbox: snapshot.isLoadingOutbox,
        isUpdatingReadState: snapshot.isUpdatingReadState,
        error: snapshot.error,
        outboxError: snapshot.outboxError,
      },
      INITIAL_MAIL_WORKSPACE_STATE,
    );
  });

  it("returns a stable snapshot reference until state changes", () => {
    const runtime = createMailWorkspaceRuntime(createApiMock().api);
    const first = runtime.getSnapshot();
    const second = runtime.getSnapshot();
    assert.equal(first, second);
  });

  it("loadMailboxes calls API client and stores mailboxes", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMailboxes();
    assert.equal(calls.mailboxes, 1);
    assert.equal(runtime.getSnapshot().mailboxes.length, 1);
    assert.equal(runtime.getSnapshot().error, null);
  });

  it("loadMessages stores message list and cursor", async () => {
    const { api } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.nextCursor, "cursor-1");
    assert.equal(snapshot.selectedMailboxId, "mailbox-1");
    assert.equal(snapshot.selectedFolder, "inbox");
  });

  it("loadMoreMessages appends pagination results", async () => {
    const { api } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().loadMoreMessages();
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.messages.length, 2);
    assert.equal(snapshot.nextCursor, null);
  });

  it("selectMessage loads detail through provider action", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "sent",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-1");
    assert.equal(runtime.getSnapshot().selectedMessageId, "message-1");
    assert.equal(calls.details.length, 1);
    assert.equal(calls.details[0]?.folder, "sent");
    assert.equal(runtime.getSnapshot().selectedMessage?.bodyText, "Body");
    assert.equal(runtime.getSnapshot().selectedMessage?.customerAssociation, null);
  });

  it("preserves customerAssociation on selectedMessage without rendering CRM UI", async () => {
    const association = {
      customerId: "22222222-2222-2222-2222-222222222201",
      customerCode: "CUST-A",
      name: "Staff A Customer",
      salesStage: "lead",
      ownerName: "Staff A",
      associationType: "auto_match" as const,
    };
    const { api } = createApiMock({
      fetchMessageDetail: async () => ({
        ...detailFixture(),
        customerAssociation: association,
      }),
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-1");
    assert.deepEqual(runtime.getSnapshot().selectedMessage?.customerAssociation, association);
  });

  it("ignores stale detail responses when selection changes rapidly", async () => {
    const { api } = createApiMock({
      fetchMessageDetail: async (input) => {
        if (input.messageId === "message-a") {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            ...detailFixture(),
            id: "message-a",
            bodyText: "A body",
            customerAssociation: {
              customerId: "cust-a",
              customerCode: "A",
              name: "Customer A",
              salesStage: "lead",
              ownerName: "Owner A",
              associationType: "auto_match" as const,
            },
          };
        }
        return {
          ...detailFixture(),
          id: "message-b",
          bodyText: "B body",
          customerAssociation: null,
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    const first = runtime.getSnapshot().selectMessage("message-a");
    await runtime.getSnapshot().selectMessage("message-b");
    await first;
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMessageId, "message-b");
    assert.equal(snapshot.selectedMessage?.id, "message-b");
    assert.equal(snapshot.selectedMessage?.bodyText, "B body");
    assert.equal(snapshot.selectedMessage?.customerAssociation, null);
  });

  it("clears customerAssociation when a new detail request starts", async () => {
    const association = {
      customerId: "cust-a",
      customerCode: "A",
      name: "Customer A",
      salesStage: "lead",
      ownerName: "Owner A",
      associationType: "auto_match" as const,
    };
    const { api } = createApiMock({
      fetchMessageDetail: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          ...detailFixture(),
          id: input.messageId,
          customerAssociation:
            input.messageId === "message-a" ? association : null,
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-a");
    assert.deepEqual(
      runtime.getSnapshot().selectedMessage?.customerAssociation,
      association,
    );

    const pending = runtime.getSnapshot().selectMessage("message-b");
    assert.equal(runtime.getSnapshot().selectedMessage, null);
    assert.equal(runtime.getSnapshot().selectedMessageId, "message-b");
    await pending;
    assert.equal(runtime.getSnapshot().selectedMessage?.customerAssociation, null);
  });

  it("selectMailbox reloads current folder with reset", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "sent",
      reset: true,
    });
    await runtime.getSnapshot().selectMailbox("mailbox-1");
    assert.equal(calls.messages.length, 2);
    assert.equal(calls.messages.at(-1)?.folder, "sent");
    assert.equal(runtime.getSnapshot().selectedMessageId, null);
  });

  it("selectFolder reloads selected mailbox folder with reset", async () => {
    const { api, calls } = createApiMock({
      fetchMessageDetail: async () => ({
        ...detailFixture(),
        customerAssociation: {
          customerId: "cust-a",
          customerCode: "A",
          name: "Customer A",
          salesStage: "lead",
          ownerName: "Owner A",
          associationType: "manual" as const,
        },
      }),
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-1");
    assert.ok(runtime.getSnapshot().selectedMessage?.customerAssociation);
    const pending = runtime.getSnapshot().selectFolder("trash");
    assert.equal(runtime.getSnapshot().selectedFolder, "trash");
    assert.equal(runtime.getSnapshot().messages.length, 0);
    await pending;
    assert.equal(calls.messages.at(-1)?.folder, "trash");
    assert.equal(runtime.getSnapshot().selectedMessageId, null);
    assert.equal(runtime.getSnapshot().selectedMessage, null);
  });

  it("clears inbox rows immediately when switching to drafts", async () => {
    const { api } = createApiMock({
      fetchDrafts: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [
          {
            id: "draft-1",
            authorUserId: "user-1",
            mailboxId: "mailbox-1",
            senderIdentityId: null,
            subject: "Draft subject",
            bodyText: "Draft body",
            bodyHtml: null,
            hasHtml: false,
            sensitivity: "normal" as const,
            composeMode: "reply" as const,
            replyToMessageId: "message-1",
            autosaveVersion: 1,
            lastSavedAt: "2026-08-23T08:30:00.000Z",
            discardedAt: null,
            createdAt: "2026-08-23T08:00:00.000Z",
            updatedAt: "2026-08-23T08:30:00.000Z",
          },
        ];
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    assert.equal(runtime.getSnapshot().messages.length, 1);
    const pending = runtime.getSnapshot().selectFolder("drafts");
    assert.equal(runtime.getSnapshot().selectedFolder, "drafts");
    assert.equal(runtime.getSnapshot().messages.length, 0);
    await pending;
    assert.equal(runtime.getSnapshot().drafts.length, 1);
  });

  it("latest folder wins after rapid inbox sent trash drafts switching", async () => {
    const { api } = createApiMock({
      fetchMessages: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, input.folder === "inbox" ? 30 : 5));
        return {
          items: [listItemFixture({ id: `message-${input.folder}`, subject: input.folder })],
          nextCursor: null,
        };
      },
      fetchDrafts: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [
          {
            id: "draft-1",
            authorUserId: "user-1",
            mailboxId: "mailbox-1",
            senderIdentityId: null,
            subject: "Draft subject",
            bodyText: "Draft body",
            bodyHtml: null,
            hasHtml: false,
            sensitivity: "normal" as const,
            composeMode: "new" as const,
            replyToMessageId: null,
            autosaveVersion: 1,
            lastSavedAt: "2026-08-23T08:30:00.000Z",
            discardedAt: null,
            createdAt: "2026-08-23T08:00:00.000Z",
            updatedAt: "2026-08-23T08:30:00.000Z",
          },
        ];
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMailboxes();
    void runtime.getSnapshot().selectFolder("inbox");
    void runtime.getSnapshot().selectFolder("sent");
    void runtime.getSnapshot().selectFolder("trash");
    await runtime.getSnapshot().selectFolder("drafts");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedFolder, "drafts");
    assert.equal(snapshot.messages.length, 0);
    assert.equal(snapshot.drafts.length, 1);
  });

  it("markMessageRead updates read state through API client", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().markMessageRead({
      messageId: "message-1",
      isRead: true,
    });
    assert.equal(calls.readStates.length, 1);
    assert.equal(calls.readStates[0]?.isRead, true);
    assert.equal(runtime.getSnapshot().messages[0]?.isUnread, false);
  });

  it("stores API errors from MailReadApiError", async () => {
    const { api } = createApiMock({
      fetchAccessibleMailboxes: async () => {
        throw new MailReadApiError(403, "Forbidden", "FORBIDDEN");
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMailboxes();
    const error = runtime.getSnapshot().error;
    assert.ok(error instanceof MailReadApiError);
    assert.equal(error?.status, 403);
    assert.equal(error?.code, "FORBIDDEN");
  });

  it("clears sensitive workspace state and cached folders", async () => {
    const { api } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-1");
    assert.equal(runtime.getSnapshot().messages.length, 1);
    assert.ok(runtime.getSnapshot().selectedMessage);

    runtime.getSnapshot().clearSensitiveState();

    assert.deepEqual(
      {
        mailboxes: runtime.getSnapshot().mailboxes,
        messages: runtime.getSnapshot().messages,
        drafts: runtime.getSnapshot().drafts,
        selectedMailboxId: runtime.getSnapshot().selectedMailboxId,
        selectedFolder: runtime.getSnapshot().selectedFolder,
        selectedMessageId: runtime.getSnapshot().selectedMessageId,
        selectedMessage: runtime.getSnapshot().selectedMessage,
        nextCursor: runtime.getSnapshot().nextCursor,
        error: runtime.getSnapshot().error,
      },
      {
        mailboxes: [],
        messages: [],
        drafts: [],
        selectedMailboxId: null,
        selectedFolder: "inbox",
        selectedMessageId: null,
        selectedMessage: null,
        nextCursor: null,
        error: null,
      },
    );
  });

  it("selectFolder drafts loads drafts without message API calls", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    const messageCallsBefore = calls.messages.length;
    await runtime.getSnapshot().selectFolder("drafts");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedFolder, "drafts");
    assert.equal(snapshot.drafts.length, 1);
    assert.equal(snapshot.drafts[0]?.id, "draft-1");
    assert.equal(calls.messages.length, messageCallsBefore);
  });

  it("falls back legacy pending_approval selection to Inbox", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-1");
    const messageCallsBefore = calls.messages.length;
    await runtime.getSnapshot().selectFolder("pending_approval");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedFolder, "inbox");
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.drafts.length, 0);
    assert.equal(snapshot.selectedMessageId, null);
    assert.equal(snapshot.selectedMessage, null);
    assert.equal(snapshot.isLoadingMessages, false);
    assert.equal(calls.messages.length, messageCallsBefore + 1);
  });

  it("selectMailbox after legacy pending state keeps the Inbox fallback", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectFolder("pending_approval");
    const messageCallsBefore = calls.messages.length;
    await runtime.getSnapshot().selectMailbox("mailbox-2");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMailboxId, "mailbox-2");
    assert.equal(snapshot.selectedFolder, "inbox");
    assert.equal(snapshot.messages.length, 1);
    assert.equal(calls.messages.length, messageCallsBefore + 1);
  });

  it("clears detail loading when list reset invalidates the in-flight selection", async () => {
    let resolveDetail: ((value: MailMessageDetailView) => void) | undefined;
    const { api } = createApiMock({
      fetchMessageDetail: async () =>
        new Promise<MailMessageDetailView>((resolve) => {
          resolveDetail = resolve;
        }),
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    const pending = runtime.getSnapshot().selectMessage("message-1");
    assert.equal(runtime.getSnapshot().isLoadingDetail, true);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    assert.equal(runtime.getSnapshot().selectedMessageId, null);
    assert.equal(runtime.getSnapshot().isLoadingDetail, false);
    resolveDetail?.(detailFixture());
    await pending;
    assert.equal(runtime.getSnapshot().isLoadingDetail, false);
    assert.equal(runtime.getSnapshot().selectedMessage, null);
  });

  it("clears detail loading when active response no longer matches selection", async () => {
    const { api } = createApiMock({
      fetchMessageDetail: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          ...detailFixture(),
          id: input.messageId,
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    const pending = runtime.getSnapshot().selectMessage("message-1");
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await pending;
    assert.equal(runtime.getSnapshot().isLoadingDetail, false);
  });

  it("stores detail API failures and clears loading", async () => {
    const { api } = createApiMock({
      fetchMessageDetail: async () => {
        throw new MailReadApiError(404, "Not found", "NOT_FOUND");
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-1");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.isLoadingDetail, false);
    assert.ok(snapshot.error instanceof MailReadApiError);
    assert.equal(snapshot.selectedMessage, null);
  });

  it("clears list loading when stale inbox response arrives after folder switch", async () => {
    const { api } = createApiMock({
      fetchMessages: async (input) => {
        if (input.folder === "inbox") {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return {
            items: [listItemFixture({ id: "message-inbox" })],
            nextCursor: null,
          };
        }
        return {
          items: [listItemFixture({ id: "message-sent" })],
          nextCursor: null,
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    const slowInbox = runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectFolder("drafts");
    await slowInbox;
    const afterDrafts = runtime.getSnapshot();
    assert.equal(afterDrafts.selectedFolder, "drafts");
    assert.equal(afterDrafts.isLoadingMessages, false);
    assert.equal(afterDrafts.drafts.length, 1);

    await runtime.getSnapshot().selectFolder("inbox");
    const backToInbox = runtime.getSnapshot();
    assert.equal(backToInbox.selectedFolder, "inbox");
    assert.equal(backToInbox.isLoadingMessages, false);
    assert.equal(backToInbox.messages[0]?.id, "message-inbox");
    assert.equal(backToInbox.selectedMailboxId, "mailbox-1");
  });

  it("updates selected folder immediately on folder switch", async () => {
    const { api } = createApiMock({
      fetchDrafts: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [
          {
            id: "draft-1",
            authorUserId: "user-1",
            mailboxId: "mailbox-1",
            senderIdentityId: null,
            subject: "Draft subject",
            bodyText: "Draft body",
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
          },
        ];
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    const pending = runtime.getSnapshot().selectFolder("drafts");
    assert.equal(runtime.getSnapshot().selectedFolder, "drafts");
    await pending;
  });

  it("does not leave orphan detail selection after abandoned detail fetch", async () => {
    const { api } = createApiMock({
      fetchMessageDetail: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return detailFixture();
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    const pending = runtime.getSnapshot().selectMessage("message-1");
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await pending;
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.isLoadingDetail, false);
    assert.equal(snapshot.selectedMessageId, null);
    assert.equal(snapshot.selectedMessage, null);
  });
});
