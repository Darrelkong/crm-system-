import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type {
  MailMessageDetailView,
  MailMessageListView,
} from "@/lib/mail/client/mail-read-types";
import {
  createMailWorkspaceRuntime,
  type MailWorkspaceApi,
} from "@/lib/mail/client/mail-workspace-context";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function createApiMock(): {
  api: MailWorkspaceApi;
  getMessageFetchCount: () => number;
} {
  let messageFetchCount = 0;
  const listItem: MailMessageListView = {
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
  };
  const detail: MailMessageDetailView = {
    ...listItem,
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

  return {
    getMessageFetchCount: () => messageFetchCount,
    api: {
      fetchAccessibleMailboxes: async () => [
        {
          id: "mailbox-1",
          address: "staff@example.com",
          displayName: "Staff",
          mailboxType: "personal",
          accessMode: "member",
          permissions: { canRead: true, canReply: false, canSend: false },
        },
      ],
      fetchMessages: async () => {
        messageFetchCount += 1;
        return { items: [listItem], nextCursor: null };
      },
      fetchMessageDetail: async () => detail,
      updateMessageReadState: async () => ({
        messageId: "message-1",
        isRead: true,
        isImportantPersonal: false,
        readAt: "2026-08-23T08:00:00.000Z",
      }),
      fetchDrafts: async () => [],
    },
  };
}

describe("desktop folder click return-to-list navigation", () => {
  const desktop = read(
    "../../../components/mail/prototype/mail-desktop-workspace.tsx",
  );
  const folderNav = read("../../../components/mail/prototype/mail-folder-nav.tsx");
  const mailboxesPane = read(
    "../../../components/mail/prototype/mail-mailboxes-pane.tsx",
  );
  const context = read("../../../lib/mail/client/mail-workspace-context.tsx");
  const shell = read("../../../components/mail/prototype/mail-prototype-shell.tsx");

  it("defines canonical returnToFolderList used by back and folder click", () => {
    assert.match(desktop, /function returnToFolderList\(\)/);
    assert.match(desktop, /function handleBackToMessageList\(\) \{\s*returnToFolderList\(\);/);
    assert.match(desktop, /workspace\?\.clearReadingSelection\(\)/);
  });

  it("checks reading focus before same-folder no-op", () => {
    assert.match(desktop, /function handleDesktopFolderSelect\(folder: MailWorkspaceFolder\)/);
    assert.match(
      desktop,
      /const sameFolder = workspace\.selectedFolder === folder;[\s\S]*const inReadingFocus = isDesktopReadingFocus\(\);[\s\S]*if \(sameFolder\) \{[\s\S]*if \(inReadingFocus\) \{[\s\S]*returnToFolderList\(\);[\s\S]*return;/,
    );
  });

  it("exits reading focus before switching to a different folder", () => {
    assert.match(
      desktop,
      /if \(inReadingFocus\) \{\s*returnToFolderList\(\);\s*\}\s*void workspace\.selectFolder\(folder\);/,
    );
  });

  it("routes desktop sidebar folder clicks through handleDesktopFolderSelect", () => {
    assert.match(desktop, /onFolderSelect=\{handleDesktopFolderSelect\}/);
    assert.match(mailboxesPane, /onFolderSelect=\{onFolderSelect\}/);
    assert.match(folderNav, /onFolderSelect\?: \(folder: MailWorkspaceFolder\) => void/);
    assert.match(
      folderNav,
      /if \(onFolderSelect\) \{\s*onFolderSelect\(folder\.id\);[\s\S]*return;/,
    );
  });

  it("does not wire desktop folder handler into mobile popover", () => {
    assert.doesNotMatch(shell, /handleDesktopFolderSelect/);
    assert.doesNotMatch(shell, /onFolderSelect=\{handleDesktopFolderSelect\}/);
  });

  it("exposes clearReadingSelection without reloading messages", () => {
    assert.match(context, /function clearReadingSelection\(\)/);
    assert.match(context, /clearReadingSelection,/);
    assert.doesNotMatch(
      context.match(/function clearReadingSelection\(\)[\s\S]*?async function selectMessage/)?.[0] ?? "",
      /loadMessages/,
    );
  });
});

describe("clearReadingSelection workspace behavior", () => {
  it("clears detail state without clearing cached list rows", async () => {
    const mock = createApiMock();
    const runtime = createMailWorkspaceRuntime(mock.api);
    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-1",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectMessage("message-1");
    assert.equal(runtime.getSnapshot().selectedMessageId, "message-1");
    const messagesBefore = runtime.getSnapshot().messages;

    runtime.getSnapshot().clearReadingSelection();
    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMessageId, null);
    assert.equal(snapshot.selectedMessage, null);
    assert.equal(snapshot.isLoadingDetail, false);
    assert.equal(snapshot.messages, messagesBefore);
    assert.equal(snapshot.selectedFolder, "inbox");
    assert.equal(snapshot.selectedMailboxId, "mailbox-1");
    assert.equal(mock.getMessageFetchCount(), 1);
  });
});
