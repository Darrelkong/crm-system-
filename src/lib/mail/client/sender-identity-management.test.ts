import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildSenderIdentityRows,
  canManageSenderIdentity,
  filterManageableSenderIdentities,
  isSystemNotificationSenderAddress,
  defaultSenderIdentityStorageKey,
  resolveSenderIdentityRowActions,
  type SenderIdentityApiItem,
} from "@/lib/mail/client/sender-identity-management";
import {
  MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
} from "@/lib/mail/notification-sending-domain";

function identity(
  overrides: Partial<SenderIdentityApiItem> = {},
): SenderIdentityApiItem {
  return {
    id: "identity-1",
    address: "staff@echfronthk.com",
    displayName: "Staff Sender",
    status: "active",
    defaultMailboxId: "mailbox-1",
    sentFolderMailboxId: null,
    aliasOfIdentityId: null,
    createdBy: "user-1",
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    ...overrides,
  };
}

describe("canManageSenderIdentity", () => {
  it("returns false when senderIdentityManagement capability is missing", () => {
    assert.equal(
      canManageSenderIdentity({ senderIdentityManagement: false }),
      false,
    );
  });

  it("returns true when senderIdentityManagement capability is granted", () => {
    assert.equal(
      canManageSenderIdentity({ senderIdentityManagement: true }),
      true,
    );
  });
});

describe("isSystemNotificationSenderAddress", () => {
  it("flags Cloudflare notification transport addresses as system-managed", () => {
    assert.equal(
      isSystemNotificationSenderAddress(MAIL_NOTIFICATION_SENDING_FROM_ADDRESS),
      true,
    );
    assert.equal(
      isSystemNotificationSenderAddress("alerts@send.echfronthk.com"),
      true,
    );
    assert.equal(isSystemNotificationSenderAddress("staff@echfronthk.com"), false);
  });
});

describe("filterManageableSenderIdentities", () => {
  it("excludes deleted and system notification transport identities", () => {
    const items = filterManageableSenderIdentities([
      identity(),
      identity({
        id: "identity-2",
        address: MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
      }),
      identity({ id: "identity-3", status: "deleted" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.address, "staff@echfronthk.com");
  });
});

describe("buildSenderIdentityRows", () => {
  it("marks the stored default sender identity", () => {
    const rows = buildSenderIdentityRows(
      [
        identity({ id: "identity-a" }),
        identity({ id: "identity-b", address: "other@echfronthk.com" }),
      ],
      "identity-b",
    );
    assert.equal(rows.find((row) => row.id === "identity-b")?.isDefaultSender, true);
    assert.equal(rows.find((row) => row.id === "identity-a")?.isDefaultSender, false);
  });
});

describe("resolveSenderIdentityRowActions", () => {
  it("shows disable and set-default for active identities", () => {
    assert.deepEqual(
      resolveSenderIdentityRowActions(
        { ...identity(), isDefaultSender: false },
        true,
      ),
      {
        showEnable: false,
        showDisable: true,
        showSetDefault: true,
      },
    );
  });

  it("shows enable for suspended identities", () => {
    assert.deepEqual(
      resolveSenderIdentityRowActions(
        { ...identity({ status: "suspended" }), isDefaultSender: false },
        true,
      ),
      {
        showEnable: true,
        showDisable: false,
        showSetDefault: false,
      },
    );
  });

  it("hides actions without sender identity management permission", () => {
    assert.deepEqual(
      resolveSenderIdentityRowActions(
        { ...identity(), isDefaultSender: false },
        false,
      ),
      {
        showEnable: false,
        showDisable: false,
        showSetDefault: false,
      },
    );
  });
});

describe("default sender preference storage", () => {
  it("builds a per-user storage key", () => {
    assert.equal(
      defaultSenderIdentityStorageKey("user-1"),
      "mail-admin-default-sender-identity:user-1",
    );
  });
});

describe("sender identity management UI wiring", () => {
  it("uses shared admin states and existing sender identity APIs", () => {
    const source = readFileSync(
      "src/components/mail/admin/sender-identity-management.tsx",
      "utf8",
    );
    assert.match(source, /MailAdminLoadingState/);
    assert.match(source, /MailAdminErrorState/);
    assert.match(source, /MailAdminEmptyState/);
    assert.match(source, /fetchSenderIdentities/);
    assert.match(source, /createSenderIdentity/);
    assert.match(source, /postSenderIdentitySuspend/);
    assert.match(source, /postSenderIdentityRestore/);
    assert.match(source, /writeDefaultSenderIdentityId/);
    assert.match(source, /hidden md:block/);
    assert.match(source, /md:hidden/);
  });
});
