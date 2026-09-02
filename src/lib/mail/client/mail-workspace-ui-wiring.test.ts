import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MailReadApiError } from "@/lib/mail/client/mail-read-api-errors";
import type {
  AccessibleMailboxView,
  MailMessageDetailView,
  MailMessageListView,
  MailReadStateView,
} from "@/lib/mail/client/mail-read-types";
import { usesProductionMailReadSource } from "@/lib/mail/client/mail-read-source";
import {
  adaptProductionListRow,
  isProductionMailReadFolder,
  isPrototypeWorkflowFolder,
  shouldRenderPrototypeMessageDetail,
} from "@/lib/mail/client/mail-workspace-ui-adapters";
import {
  createMailWorkspaceRuntime,
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
    drafts: number;
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
    drafts: 0,
  };

  const api: MailWorkspaceApi = {
    fetchAccessibleMailboxes: async () => {
      calls.mailboxes += 1;
      return [
        mailboxFixture(),
        mailboxFixture({
          id: "mailbox-2",
          address: "shared@example.com",
          displayName: "Shared",
          mailboxType: "shared",
        }),
      ];
    },
    fetchMessages: async (input) => {
      calls.messages.push({
        mailboxId: input.mailboxId,
        folder: input.folder,
        cursor: input.cursor,
      });
      return {
        items: [
          listItemFixture({
            id: `message-${input.mailboxId}-${input.folder}`,
            mailboxId: input.mailboxId,
          }),
        ],
        nextCursor: null,
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
    fetchDrafts: async () => {
      calls.drafts += 1;
      return [
        {
          id: "draft-1",
          authorUserId: "user-1",
          mailboxId: "mailbox-1",
          senderIdentityId: null,
          subject: "Saved reply",
          bodyText: "Draft body",
          bodyHtml: null,
          hasHtml: false,
          sensitivity: "normal",
          composeMode: "reply",
          replyToMessageId: "message-1",
          autosaveVersion: 2,
          lastSavedAt: "2026-08-23T08:30:00.000Z",
          discardedAt: null,
          createdAt: "2026-08-23T08:00:00.000Z",
          updatedAt: "2026-08-23T08:30:00.000Z",
        },
      ];
    },
    ...overrides,
  };

  return { api, calls };
}

describe("mail workspace production ui wiring", () => {
  it("uses prototype source by default and production when configured", () => {
    assert.equal(usesProductionMailReadSource("prototype"), false);
    assert.equal(usesProductionMailReadSource("production"), true);
  });

  it("does not treat workflow folders as production read folders", () => {
    assert.equal(isProductionMailReadFolder("drafts"), false);
    assert.equal(isPrototypeWorkflowFolder("pending_approval"), true);
  });

  it("loads accessible mailboxes for production mailbox navigation", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMailboxes();
    assert.equal(calls.mailboxes, 1);
    assert.equal(runtime.getSnapshot().mailboxes.length, 2);
  });

  it("selectMailbox reloads messages for the current folder with reset", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMailbox("mailbox-2");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMailboxId, "mailbox-2");
    assert.equal(snapshot.selectedFolder, "inbox");
    assert.equal(snapshot.messages[0]?.id, "message-mailbox-2-inbox");
    assert.equal(calls.messages.at(-1)?.mailboxId, "mailbox-2");
    assert.equal(calls.messages.at(-1)?.folder, "inbox");
  });

  it("selectFolder requests inbox, sent, and trash without workflow folders", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });

    await runtime.getSnapshot().selectFolder("sent");
    assert.equal(runtime.getSnapshot().selectedFolder, "sent");
    assert.equal(calls.messages.at(-1)?.folder, "sent");

    await runtime.getSnapshot().selectFolder("trash");
    assert.equal(runtime.getSnapshot().selectedFolder, "trash");
    assert.equal(calls.messages.at(-1)?.folder, "trash");
    assert.equal(isProductionMailReadFolder("pending"), false);
  });

  it("selectFolder drafts loads drafts via fetchDrafts", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectFolder("drafts");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedFolder, "drafts");
    assert.equal(snapshot.drafts.length, 1);
    assert.equal(snapshot.drafts[0]?.subject, "Saved reply");
    assert.equal(calls.drafts, 1);
    assert.equal(calls.messages.at(-1)?.folder, "inbox");
  });

  it("clears selected message when mailbox/folder reset begins", async () => {
    const { api } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-mailbox-1-inbox");
    assert.equal(runtime.getSnapshot().selectedMessageId, "message-mailbox-1-inbox");

    await runtime.getSnapshot().selectMailbox("mailbox-2");
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMessageId, null);
    assert.equal(snapshot.selectedMessage, null);
  });

  it("tracks selectedMessageId immediately when selecting a row", async () => {
    const { api } = createApiMock({
      fetchMessageDetail: async (input) => {
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
    const pending = runtime.getSnapshot().selectMessage("message-mailbox-1-inbox");
    assert.equal(runtime.getSnapshot().selectedMessageId, "message-mailbox-1-inbox");
    await pending;
    assert.equal(runtime.getSnapshot().selectedMessage?.bodyText, "Body");
  });

  it("maps production unread styling from isUnread", () => {
    const unreadRow = adaptProductionListRow(listItemFixture({ isUnread: true }));
    const readRow = adaptProductionListRow(listItemFixture({ isUnread: false }));
    assert.equal(unreadRow.isUnread, true);
    assert.equal(readRow.isUnread, false);
  });

  it("marks production messages read through provider action", async () => {
    const { api, calls } = createApiMock();
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
    assert.equal(calls.readStates.length, 1);
    assert.equal(runtime.getSnapshot().messages[0]?.isUnread, false);
  });

  it("keeps same-folder cached messages visible while a reset load is in flight", async () => {
    const { api } = createApiMock({
      fetchMessages: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          items: [
            listItemFixture({
              id: `message-${input.mailboxId}-${input.folder}`,
              mailboxId: input.mailboxId,
            }),
          ],
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
    const cachedInboxRows = runtime.getSnapshot().messages;
    assert.equal(cachedInboxRows.length, 1);

    const pending = runtime.getSnapshot().refreshMessages();
    const duringLoad = runtime.getSnapshot();
    assert.deepEqual(duringLoad.messages, cachedInboxRows);
    assert.equal(duringLoad.isLoadingMessages, true);
    assert.equal(duringLoad.selectedFolder, "inbox");

    await pending;
    assert.equal(runtime.getSnapshot().isLoadingMessages, false);
  });

  it("clears inbox rows immediately when switching to sent", async () => {
    const { api } = createApiMock({
      fetchMessages: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          items: [
            listItemFixture({
              id: `message-${input.folder}`,
              subject: input.folder,
            }),
          ],
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
    assert.equal(runtime.getSnapshot().messages[0]?.subject, "inbox");

    const pending = runtime.getSnapshot().selectFolder("sent");
    const duringSwitch = runtime.getSnapshot();
    assert.equal(duringSwitch.selectedFolder, "sent");
    assert.equal(duringSwitch.messages.length, 0);
    assert.equal(duringSwitch.isLoadingMessages, true);

    await pending;
    assert.equal(runtime.getSnapshot().messages[0]?.subject, "sent");
  });

  it("restores cached sent rows immediately when returning to sent", async () => {
    const { api } = createApiMock({
      fetchMessages: async (input) => {
        return {
          items: [
            listItemFixture({
              id: `message-${input.folder}`,
              subject: input.folder,
            }),
          ],
          nextCursor: null,
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "sent",
      reset: true,
    });
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
      previousFolder: "sent",
    });
    const pending = runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "sent",
      reset: true,
      previousFolder: "inbox",
    });
    assert.equal(runtime.getSnapshot().selectedFolder, "sent");
    assert.equal(runtime.getSnapshot().messages[0]?.subject, "sent");
    await pending;
  });

  it("ignores stale inbox response after rapid switch to drafts", async () => {
    const { api } = createApiMock({
      fetchMessages: async (input) => {
        if (input.folder === "inbox") {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return {
          items: [listItemFixture({ id: `message-${input.folder}` })],
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
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedFolder, "drafts");
    assert.equal(snapshot.messages.length, 0);
    assert.equal(snapshot.drafts.length, 1);
  });

  it("stores API errors without exposing raw server details in adapter mapping", async () => {
    const { api } = createApiMock({
      fetchMessages: async () => {
        throw new MailReadApiError(403, "Raw forbidden detail", "FORBIDDEN");
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    const error = runtime.getSnapshot().error;
    assert.ok(error instanceof MailReadApiError);
    assert.equal(error?.status, 403);
  });

  it("forbids prototype detail rendering for production source", () => {
    assert.equal(shouldRenderPrototypeMessageDetail("production"), false);
  });

  it("clears stale selectedMessage when a new detail request starts", async () => {
    const { api } = createApiMock({
      fetchMessageDetail: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          ...detailFixture(),
          id: input.messageId,
          bodyText: `Body for ${input.messageId}`,
        };
      },
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-mailbox-1-inbox");
    assert.equal(runtime.getSnapshot().selectedMessage?.bodyText, "Body for message-mailbox-1-inbox");

    const pending = runtime.getSnapshot().selectMessage("message-b");
    assert.equal(runtime.getSnapshot().selectedMessage, null);
    assert.equal(runtime.getSnapshot().selectedMessageId, "message-b");
    await pending;
    assert.equal(runtime.getSnapshot().selectedMessage?.id, "message-b");
  });

  it("uses production detail customerAssociation without prototype resolver", () => {
    const source = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-production-reading-pane.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /selectedMessage\.customerAssociation/);
    assert.doesNotMatch(source, /resolveMailMessageCustomerAssociation/);
  });

  it("wires desktop wide-layout message list selection to onSelectMessage", () => {
    const source = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-desktop-workspace.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const wideLayoutListMatches = [
      ...source.matchAll(
        /<MailMessageList[\s\S]*?onMessageSelect=\{handleSelectMessage\}/g,
      ),
    ];
    assert.ok(
      wideLayoutListMatches.length >= 2,
      "expected both wide and stack layouts to forward message selection",
    );
  });

  it("revalidates visible production mail on focus and bounded interval", () => {
    const source = readFileSync(
      new URL(
        "./mail-workspace-data-source-boundary.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(source, /MAIL_WORKSPACE_REVALIDATION_INTERVAL_MS = 60_000/);
    assert.match(source, /workspace\.refreshMessages\(\)/);
    assert.match(source, /window\.addEventListener\("focus"/);
    assert.match(source, /document\.addEventListener\("visibilitychange"/);
    assert.match(source, /document\.visibilityState !== "visible"/);
  });

  it("uses the shared contained body renderer for production reading", () => {
    const pane = readFileSync(
      new URL(
        "../../../components/mail/prototype/mail-production-reading-pane.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const renderer = readFileSync(
      new URL(
        "../../../components/mail/mail-message-body-renderer.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const styles = readFileSync(
      new URL("../../../app/globals.css", import.meta.url),
      "utf8",
    );

    assert.match(pane, /MailMessageBodyRenderer/);
    assert.doesNotMatch(pane, /dangerouslySetInnerHTML/);
    assert.match(renderer, /resolveMailMessageBody/);
    assert.match(renderer, /noopener noreferrer/);
    assert.match(styles, /\.mail-message-body--html/);
    assert.match(styles, /overflow-wrap: anywhere/);
    assert.match(styles, /overflow-x: auto/);
  });
});
