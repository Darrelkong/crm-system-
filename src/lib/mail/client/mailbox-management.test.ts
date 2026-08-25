import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildMailboxRows,
  canManageMailboxes,
  filterManageableMailboxes,
  isSystemSendingDomainAddress,
  resolveMailboxOwnerLabel,
  resolveMailboxRowActions,
  type MailboxApiItem,
} from "@/lib/mail/client/mailbox-management";
import { MAIL_NOTIFICATION_SENDING_DOMAIN } from "@/lib/mail/notification-sending-domain";

function mailbox(
  overrides: Partial<MailboxApiItem> = {},
): MailboxApiItem {
  return {
    id: "mailbox-1",
    address: "staff@echfronthk.com",
    displayName: "Staff Mailbox",
    mailboxType: "personal",
    status: "active",
    createdBy: "user-1",
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    ...overrides,
  };
}

describe("canManageMailboxes", () => {
  it("returns false when mailboxManagement capability is missing", () => {
    assert.equal(canManageMailboxes({ mailboxManagement: false }), false);
  });

  it("returns true when mailboxManagement capability is granted", () => {
    assert.equal(canManageMailboxes({ mailboxManagement: true }), true);
  });
});

describe("isSystemSendingDomainAddress", () => {
  it("flags send.echfronthk.com addresses as system-managed", () => {
    assert.equal(
      isSystemSendingDomainAddress(`notifications@${MAIL_NOTIFICATION_SENDING_DOMAIN}`),
      true,
    );
    assert.equal(isSystemSendingDomainAddress("staff@echfronthk.com"), false);
  });
});

describe("filterManageableMailboxes", () => {
  it("excludes deleted and system sending domain mailboxes", () => {
    const items = filterManageableMailboxes([
      mailbox(),
      mailbox({
        id: "mailbox-2",
        address: `system@${MAIL_NOTIFICATION_SENDING_DOMAIN}`,
      }),
      mailbox({ id: "mailbox-3", status: "deleted" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.address, "staff@echfronthk.com");
  });
});

describe("buildMailboxRows", () => {
  it("resolves owner labels and sorts by address", () => {
    const rows = buildMailboxRows(
      [
        mailbox({ id: "b", address: "z@echfronthk.com", createdBy: "user-2" }),
        mailbox({ id: "a", address: "a@echfronthk.com", createdBy: "user-1" }),
      ],
      [
        { id: "user-1", name: "Alice", email: "alice@example.com", status: "active" },
        { id: "user-2", name: "Bob", email: "bob@example.com", status: "active" },
      ],
    );
    assert.equal(rows[0]?.address, "a@echfronthk.com");
    assert.equal(rows[0]?.ownerLabel, "Alice");
    assert.equal(rows[1]?.ownerLabel, "Bob");
  });
});

describe("resolveMailboxOwnerLabel", () => {
  it("falls back to the raw user id when owner is unknown", () => {
    assert.equal(
      resolveMailboxOwnerLabel("missing-user", new Map()),
      "missing-user",
    );
  });
});

describe("resolveMailboxRowActions", () => {
  it("shows disable for active mailboxes when permitted", () => {
    assert.deepEqual(
      resolveMailboxRowActions({ ...mailbox(), ownerLabel: "Alice" }, true),
      { showEnable: false, showDisable: true },
    );
  });

  it("shows enable for suspended mailboxes when permitted", () => {
    assert.deepEqual(
      resolveMailboxRowActions(
        { ...mailbox({ status: "suspended" }), ownerLabel: "Alice" },
        true,
      ),
      { showEnable: true, showDisable: false },
    );
  });

  it("hides actions without mailbox management permission", () => {
    assert.deepEqual(
      resolveMailboxRowActions({ ...mailbox(), ownerLabel: "Alice" }, false),
      { showEnable: false, showDisable: false },
    );
  });
});

describe("mailbox management UI wiring", () => {
  it("uses shared admin states and existing mailbox APIs", () => {
    const source = readFileSync(
      "src/components/mail/admin/mailbox-management.tsx",
      "utf8",
    );
    assert.match(source, /MailAdminLoadingState/);
    assert.match(source, /MailAdminErrorState/);
    assert.match(source, /MailAdminEmptyState/);
    assert.match(source, /fetchMailboxes/);
    assert.match(source, /createMailbox/);
    assert.match(source, /postMailboxSuspend/);
    assert.match(source, /postMailboxRestore/);
    assert.match(source, /hidden md:block/);
    assert.match(source, /md:hidden/);
  });
});
