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
  mergeMessagePage,
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
        selectedMessage: snapshot.selectedMessage,
        selectedMessageId: snapshot.selectedMessageId,
        nextCursor: snapshot.nextCursor,
        isLoadingMailboxes: snapshot.isLoadingMailboxes,
        isLoadingMessages: snapshot.isLoadingMessages,
        isLoadingDetail: snapshot.isLoadingDetail,
        isUpdatingReadState: snapshot.isUpdatingReadState,
        error: snapshot.error,
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
    await runtime.getSnapshot().selectFolder("trash");
    assert.equal(calls.messages.at(-1)?.folder, "trash");
    assert.equal(runtime.getSnapshot().selectedFolder, "trash");
    assert.equal(runtime.getSnapshot().selectedMessageId, null);
    assert.equal(runtime.getSnapshot().selectedMessage, null);
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
});
