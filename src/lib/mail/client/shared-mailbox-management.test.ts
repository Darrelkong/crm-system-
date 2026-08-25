import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { MailboxApiItem } from "@/lib/mail/client/mailbox-management";
import { MAIL_NOTIFICATION_SENDING_FROM_ADDRESS } from "@/lib/mail/notification-sending-domain";
import {
  buildSharedMailboxMemberRows,
  buildSharedMailboxRows,
  canManageSharedMailboxes,
  filterManageableSharedMailboxes,
  hasAnyMemberPermission,
  memberPermissionsFromRole,
  resolveSharedMailboxMemberRowActions,
  type MailboxMemberApiItem,
} from "@/lib/mail/client/shared-mailbox-management";
import { deriveMailboxMemberRoleLabel } from "@/lib/mail/mailbox-member-serialization";

function mailbox(overrides: Partial<MailboxApiItem> = {}): MailboxApiItem {
  return {
    id: "mailbox-1",
    address: "hello@echfronthk.com",
    displayName: "Hello Team",
    mailboxType: "shared",
    status: "active",
    createdBy: "user-1",
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    ...overrides,
  };
}

function member(overrides: Partial<MailboxMemberApiItem> = {}): MailboxMemberApiItem {
  return {
    id: "member-1",
    mailboxId: "mailbox-1",
    userId: "user-2",
    canRead: true,
    canReply: true,
    canSend: false,
    canAssign: false,
    canManageProcessing: false,
    canAddInternalNote: true,
    grantedBy: "user-1",
    revokedAt: null,
    revokedBy: null,
    createdAt: "2026-08-22T08:00:00.000Z",
    updatedAt: "2026-08-22T08:00:00.000Z",
    ...overrides,
  };
}

describe("canManageSharedMailboxes", () => {
  it("returns false when mailboxManagement capability is missing", () => {
    assert.equal(canManageSharedMailboxes({ mailboxManagement: false }), false);
  });

  it("returns true when mailboxManagement capability is granted", () => {
    assert.equal(canManageSharedMailboxes({ mailboxManagement: true }), true);
  });
});

describe("filterManageableSharedMailboxes", () => {
  it("includes shared mailboxes and excludes personal and system transport addresses", () => {
    const items = filterManageableSharedMailboxes([
      mailbox(),
      mailbox({ id: "mailbox-2", mailboxType: "personal" }),
      mailbox({
        id: "mailbox-3",
        address: MAIL_NOTIFICATION_SENDING_FROM_ADDRESS,
      }),
      mailbox({ id: "mailbox-4", status: "deleted" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.address, "hello@echfronthk.com");
  });
});

describe("buildSharedMailboxRows", () => {
  it("builds shared mailbox rows with member counts", () => {
    const rows = buildSharedMailboxRows(
      [
        mailbox(),
        mailbox({ id: "mailbox-2", mailboxType: "personal" }),
      ],
      new Map([["mailbox-1", 3]]),
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.memberCount, 3);
    assert.equal(rows[0]?.displayName, "Hello Team");
  });
});

describe("buildSharedMailboxMemberRows", () => {
  it("renders member user labels, derived roles, and permissions", () => {
    const rows = buildSharedMailboxMemberRows(
      [member(), member({ id: "member-2", userId: "user-3", canRead: true, canReply: false, canSend: false, canAddInternalNote: false })],
      [{ id: "user-2", email: "a@example.com", name: "Alice", status: "active" }],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.userLabel, "Alice");
    assert.equal(rows[0]?.roleLabel, "reply");
    assert.equal(rows[1]?.roleLabel, "read_only");
  });
});

describe("member permission helpers", () => {
  it("maps role presets to permission flags", () => {
    assert.deepEqual(memberPermissionsFromRole("full"), {
      canRead: true,
      canReply: true,
      canSend: true,
      canAssign: true,
      canManageProcessing: true,
      canAddInternalNote: true,
    });
    assert.equal(hasAnyMemberPermission(memberPermissionsFromRole("read_only")), true);
    assert.equal(
      deriveMailboxMemberRoleLabel(memberPermissionsFromRole("reply")),
      "reply",
    );
  });

  it("exposes edit and remove actions when management is allowed", () => {
    assert.deepEqual(resolveSharedMailboxMemberRowActions(true), {
      showRemove: true,
      showEdit: true,
    });
    assert.deepEqual(resolveSharedMailboxMemberRowActions(false), {
      showRemove: false,
      showEdit: false,
    });
  });
});

describe("shared mailbox UI wiring", () => {
  it("registers the shared mailbox section in admin center navigation", () => {
    const navSource = readFileSync(
      "src/components/mail/admin/mail-admin-center-nav.tsx",
      "utf8",
    );
    assert.match(navSource, /sharedMailbox: "mail\.adminCenter\.sections\.sharedMailbox"/);
  });

  it("renders SharedMailboxManagement in the section panel", () => {
    const panelSource = readFileSync(
      "src/components/mail/admin/mail-admin-center-section-panel.tsx",
      "utf8",
    );
    assert.match(panelSource, /section === "sharedMailbox"/);
    assert.match(panelSource, /<SharedMailboxManagement \/>/);
  });
});
