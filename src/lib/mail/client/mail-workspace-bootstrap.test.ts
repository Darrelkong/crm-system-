import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProductionBootstrapTracker,
  nextProductionBootstrapCommand,
  PRODUCTION_BOOTSTRAP_INITIAL_FOLDER,
  resolveInitialProductionMailbox,
} from "@/lib/mail/client/mail-workspace-bootstrap";
import { shouldMountProductionWorkspaceProvider } from "@/lib/mail/client/mail-workspace-data-source-boundary";
import type { AccessibleMailboxView } from "@/lib/mail/client/mail-read-types";

function mailbox(id: string): AccessibleMailboxView {
  return {
    id,
    address: `${id}@example.com`,
    displayName: id,
    mailboxType: "shared",
    accessMode: "member",
    permissions: { canRead: true, canReply: false, canSend: false },
  };
}

function snapshot(
  overrides: Partial<Parameters<typeof nextProductionBootstrapCommand>[0]> = {},
) {
  const tracker = createProductionBootstrapTracker();
  return {
    mailAccessEnabled: true,
    mailboxes: [],
    selectedMailboxId: null,
    selectedFolder: PRODUCTION_BOOTSTRAP_INITIAL_FOLDER,
    isLoadingMailboxes: false,
    isLoadingMessages: false,
    mailboxesFetchStarted: tracker.getMailboxesFetchStarted(),
    inboxLoadedMailboxId: tracker.getInboxLoadedMailboxId(),
    mailboxesFetchInFlight: false,
    inboxFetchInFlightMailboxId: null,
    ...overrides,
  };
}

describe("mail workspace data source boundary", () => {
  it("mounts production provider only for production source", () => {
    assert.equal(shouldMountProductionWorkspaceProvider("prototype"), false);
    assert.equal(shouldMountProductionWorkspaceProvider("production"), true);
  });
});

describe("production workspace bootstrap", () => {
  it("selects the first accessible mailbox when none is selected", () => {
    assert.equal(
      resolveInitialProductionMailbox([mailbox("mailbox-a"), mailbox("mailbox-b")], null),
      "mailbox-a",
    );
  });

  it("keeps an already-selected mailbox", () => {
    assert.equal(
      resolveInitialProductionMailbox([mailbox("mailbox-a")], "mailbox-selected"),
      "mailbox-selected",
    );
  });

  it("handles zero accessible mailboxes without throwing", () => {
    assert.equal(resolveInitialProductionMailbox([], null), null);
    assert.deepEqual(
      nextProductionBootstrapCommand(
        snapshot({
          mailboxesFetchStarted: true,
          mailboxes: [],
        }),
      ),
      { type: "none" },
    );
  });

  it("requests mailbox load before inbox load", () => {
    assert.deepEqual(nextProductionBootstrapCommand(snapshot()), {
      type: "fetch-mailboxes",
    });

    assert.deepEqual(
      nextProductionBootstrapCommand(
        snapshot({
          mailboxesFetchStarted: true,
          mailboxes: [mailbox("mailbox-a")],
        }),
      ),
      { type: "fetch-inbox", mailboxId: "mailbox-a" },
    );
  });

  it("uses inbox as the initial folder command target", () => {
    const command = nextProductionBootstrapCommand(
      snapshot({
        mailboxesFetchStarted: true,
        mailboxes: [mailbox("mailbox-a")],
        selectedFolder: PRODUCTION_BOOTSTRAP_INITIAL_FOLDER,
      }),
    );
    assert.equal(command.type, "fetch-inbox");
    if (command.type === "fetch-inbox") {
      assert.equal(command.mailboxId, "mailbox-a");
    }
  });

  it("does not overwrite inbox bootstrap once loaded for mailbox", () => {
    assert.deepEqual(
      nextProductionBootstrapCommand(
        snapshot({
          mailboxesFetchStarted: true,
          mailboxes: [mailbox("mailbox-a"), mailbox("mailbox-b")],
          selectedMailboxId: "mailbox-a",
          inboxLoadedMailboxId: "mailbox-a",
        }),
      ),
      { type: "none" },
    );
  });

  it("avoids duplicate logical loads while fetches are in flight", () => {
    assert.deepEqual(
      nextProductionBootstrapCommand(
        snapshot({
          mailboxesFetchInFlight: true,
        }),
      ),
      { type: "none" },
    );

    assert.deepEqual(
      nextProductionBootstrapCommand(
        snapshot({
          mailboxesFetchStarted: true,
          mailboxes: [mailbox("mailbox-a")],
          inboxFetchInFlightMailboxId: "mailbox-a",
        }),
      ),
      { type: "none" },
    );
  });

  it("does not bootstrap when mail access is disabled", () => {
    assert.deepEqual(
      nextProductionBootstrapCommand(
        snapshot({
          mailAccessEnabled: false,
        }),
      ),
      { type: "none" },
    );
  });
});
