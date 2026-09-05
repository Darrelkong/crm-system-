import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessibleMailboxView } from "@/lib/mail/client/mail-read-types";
import { resolveEffectiveMailboxId } from "@/lib/mail/client/mail-workspace-mailbox-selection";
import {
  createMailWorkspaceRuntime,
  resolveMailboxMessageLoadFolder,
  type MailWorkspaceApi,
} from "@/lib/mail/client/mail-workspace-context";
import { resolveMailboxSidebarSections } from "@/lib/mail/client/mail-workspace-ui-adapters";

function mailbox(
  id: string,
  mailboxType: AccessibleMailboxView["mailboxType"] = "personal",
): AccessibleMailboxView {
  return {
    id,
    address: `${id}@example.com`,
    displayName: id,
    mailboxType,
    accessMode: "member",
    permissions: { canRead: true, canReply: false, canSend: false },
  };
}

describe("resolveEffectiveMailboxId", () => {
  it("uses selected mailbox when it remains accessible", () => {
    assert.equal(
      resolveEffectiveMailboxId({
        selectedMailboxId: "mailbox-b",
        mailboxes: [mailbox("mailbox-a"), mailbox("mailbox-b")],
      }),
      "mailbox-b",
    );
  });

  it("auto-selects the sole accessible mailbox when none is selected", () => {
    assert.equal(
      resolveEffectiveMailboxId({
        selectedMailboxId: null,
        mailboxes: [mailbox("sole-mailbox")],
      }),
      "sole-mailbox",
    );
  });

  it("auto-selects a sole shared mailbox without personal mailboxes", () => {
    assert.equal(
      resolveEffectiveMailboxId({
        selectedMailboxId: null,
        mailboxes: [mailbox("shared-only", "shared")],
      }),
      "shared-only",
    );
  });

  it("does not auto-select when multiple mailboxes exist and none is selected", () => {
    assert.equal(
      resolveEffectiveMailboxId({
        selectedMailboxId: null,
        mailboxes: [mailbox("mailbox-a"), mailbox("mailbox-b")],
      }),
      null,
    );
  });

  it("allows bootstrap fallback to first mailbox for multi-mailbox bootstrap only", () => {
    assert.equal(
      resolveEffectiveMailboxId({
        selectedMailboxId: null,
        mailboxes: [mailbox("mailbox-a"), mailbox("mailbox-b")],
        bootstrapFallbackToFirst: true,
      }),
      "mailbox-a",
    );
  });

  it("does not use stale selected mailbox IDs that are no longer accessible", () => {
    assert.equal(
      resolveEffectiveMailboxId({
        selectedMailboxId: "revoked-mailbox",
        mailboxes: [mailbox("mailbox-a")],
      }),
      "mailbox-a",
    );
  });

  it("returns null for stale selection with multiple accessible mailboxes", () => {
    assert.equal(
      resolveEffectiveMailboxId({
        selectedMailboxId: "revoked-mailbox",
        mailboxes: [mailbox("mailbox-a"), mailbox("mailbox-b")],
      }),
      null,
    );
  });

  it("preserves selected mailbox before accessible mailboxes finish loading", () => {
    assert.equal(
      resolveEffectiveMailboxId({
        selectedMailboxId: "mailbox-b",
        mailboxes: [],
      }),
      "mailbox-b",
    );
  });
});

describe("single mailbox workspace regression", () => {
  function createApiMock(overrides: Partial<MailWorkspaceApi> = {}): {
    api: MailWorkspaceApi;
    calls: {
      mailboxes: number;
      messages: Array<{ mailboxId: string; folder: string }>;
      drafts: Array<{ mailboxId?: string }>;
    };
  } {
    const calls = {
      mailboxes: 0,
      messages: [] as Array<{ mailboxId: string; folder: string }>,
      drafts: [] as Array<{ mailboxId?: string }>,
    };

    const api: MailWorkspaceApi = {
      fetchAccessibleMailboxes: async () => {
        calls.mailboxes += 1;
        return [mailbox("daniel-mailbox", "personal")];
      },
      fetchMessages: async (input) => {
        calls.messages.push({
          mailboxId: input.mailboxId,
          folder: input.folder,
        });
        return {
          items: [
            {
              id: `message-${input.folder}`,
              threadId: "thread-1",
              mailboxId: input.mailboxId,
              direction: input.folder === "sent" ? "outbound" : "inbound",
              sender: { address: "client@example.com", displayName: "Client" },
              subject: input.folder,
              preview: "Preview",
              timestamp: "2026-08-28T10:00:00.000Z",
              isUnread: false,
              isImportantPersonal: false,
              hasAttachments: false,
              attachmentCount: 0,
            },
          ],
          nextCursor: null,
        };
      },
      fetchMessageDetail: async (input) => {
        throw new Error(`Unexpected detail fetch: ${input.messageId}`);
      },
      updateMessageReadState: async (input) => ({
        messageId: input.messageId,
        isRead: input.patch.isRead ?? false,
        isImportantPersonal: false,
        readAt: null,
      }),
      fetchDrafts: async (input) => {
        calls.drafts.push({ mailboxId: input?.mailboxId });
        return [];
      },
      ...overrides,
    };

    return { api, calls };
  }

  it("loads inbox automatically after sole mailbox discovery", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);

    await runtime.getSnapshot().loadMailboxes();

    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMailboxId, "daniel-mailbox");
    assert.equal(snapshot.messages.length, 1);
    assert.equal(calls.messages.at(-1)?.mailboxId, "daniel-mailbox");
    assert.equal(calls.messages.at(-1)?.folder, "inbox");
  });

  it("selectFolder inbox no-ops before accessible mailboxes are loaded", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);

    await runtime.getSnapshot().selectFolder("inbox");

    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMailboxId, null);
    assert.equal(snapshot.messages.length, 0);
    assert.equal(calls.messages.length, 0);
  });

  it("selectFolder sent loads sole mailbox after mailboxes are discovered", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMailboxes();
    await runtime.getSnapshot().selectFolder("sent");

    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMailboxId, "daniel-mailbox");
    assert.equal(snapshot.selectedFolder, "sent");
    assert.equal(calls.messages.at(-1)?.folder, "sent");
  });

  it("refreshMessages resolves sole mailbox for current folder", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMailboxes();
    await runtime.getSnapshot().refreshMessages();

    assert.equal(calls.messages.at(-1)?.mailboxId, "daniel-mailbox");
    assert.equal(calls.messages.at(-1)?.folder, "inbox");
  });

  it("loadDrafts binds sole mailbox for draft queries", async () => {
    const { api, calls } = createApiMock();
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMailboxes();
    await runtime.getSnapshot().loadDrafts();

    assert.equal(calls.drafts.at(-1)?.mailboxId, "daniel-mailbox");
    assert.equal(runtime.getSnapshot().selectedMailboxId, "daniel-mailbox");
  });

  it("keeps mailbox sidebar hidden for one personal mailbox while data loads", () => {
    const sections = resolveMailboxSidebarSections([
      {
        id: "daniel-mailbox",
        address: "daniel.hayes@echfronthk.com",
        displayName: "Daniel.Hayes",
        mailboxType: "personal",
      },
    ]);

    assert.equal(sections.showSection, false);
    assert.equal(sections.personalMailboxes.length, 1);
  });

  it("does not auto-select when multiple mailboxes exist without explicit selection", async () => {
    const { api, calls } = createApiMock({
      fetchAccessibleMailboxes: async () => [
        mailbox("mailbox-a"),
        mailbox("mailbox-b"),
      ],
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().loadMailboxes();

    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMailboxId, null);
    assert.equal(snapshot.messages.length, 0);
    assert.equal(calls.messages.length, 0);
  });

  it("preserves explicit mailbox selection across folder changes", async () => {
    const { api, calls } = createApiMock({
      fetchAccessibleMailboxes: async () => [
        mailbox("mailbox-a"),
        mailbox("mailbox-b"),
      ],
    });
    const runtime = createMailWorkspaceRuntime(api);
    await runtime.getSnapshot().selectMailbox("mailbox-b");
    await runtime.getSnapshot().selectFolder("sent");

    assert.equal(runtime.getSnapshot().selectedMailboxId, "mailbox-b");
    assert.equal(calls.messages.at(-1)?.mailboxId, "mailbox-b");
    assert.equal(calls.messages.at(-1)?.folder, "sent");
  });

  it("preserves Drafts when switching mailboxes through the Draft service", async () => {
    const { api, calls } = createApiMock({
      fetchAccessibleMailboxes: async () => [
        mailbox("mailbox-a"),
        mailbox("mailbox-b"),
      ],
    });
    const runtime = createMailWorkspaceRuntime(api);

    await runtime.getSnapshot().loadMessages({
      mailboxId: "mailbox-a",
      folder: "inbox",
      reset: true,
    });
    await runtime.getSnapshot().selectFolder("drafts");
    await runtime.getSnapshot().selectMailbox("mailbox-b");

    const snapshot = runtime.getSnapshot();
    assert.equal(snapshot.selectedMailboxId, "mailbox-b");
    assert.equal(snapshot.selectedFolder, "drafts");
    assert.equal(calls.drafts.at(-1)?.mailboxId, "mailbox-b");
    assert.equal(calls.messages.at(-1)?.folder, "inbox");
  });

  it("maps approval virtual folders without requiring mailbox message loads", () => {
    assert.equal(resolveMailboxMessageLoadFolder("pending_approval"), null);
  });
});
