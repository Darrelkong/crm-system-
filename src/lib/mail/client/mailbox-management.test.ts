import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildCreateMailboxRequest,
  buildMailboxRows,
  canManageMailboxes,
  filterManageableMailboxes,
  isMailboxCreateSubmitEnabled,
  isSystemSendingDomainAddress,
  listPersonalMailboxOwnerCandidates,
  resolveMailboxOwnerLabel,
  resolveMailboxRowActions,
  resolveMailboxTypeChange,
  validateMailboxCreateForm,
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
    assert.match(source, /fetchMailAccessList/);
    assert.match(source, /createMailbox/);
    assert.match(source, /ownerUserId/);
    assert.match(source, /listPersonalMailboxOwnerCandidates/);
    assert.match(source, /postMailboxSuspend/);
    assert.match(source, /postMailboxRestore/);
    assert.match(source, /hidden md:block/);
    assert.match(source, /md:hidden/);
  });
});

describe("personal mailbox owner create form", () => {
  const users = [
    { id: "daniel", name: "Daniel.Hayes", email: "daniel.hayes@echfronthk.com", status: "active" as const },
    { id: "staff-b", name: "Staff B", email: "staffb@echfronthk.com", status: "active" as const },
    { id: "disabled", name: "Disabled", email: "disabled@echfronthk.com", status: "disabled" as const },
  ];
  const accessItems = [
    {
      userId: "daniel",
      isEnabled: 1,
      enabledAt: "2026-08-26T10:43:31.470Z",
      disabledAt: null,
      createdAt: "2026-08-26T10:43:31.470Z",
      updatedAt: "2026-08-26T10:43:31.470Z",
      hasVerifiedNotificationIdentity: true,
    },
    {
      userId: "staff-b",
      isEnabled: 0,
      enabledAt: null,
      disabledAt: "2026-08-26T10:43:31.470Z",
      createdAt: "2026-08-26T10:43:31.470Z",
      updatedAt: "2026-08-26T10:43:31.470Z",
      hasVerifiedNotificationIdentity: false,
    },
  ];

  it("lists only active users with Mail User Access enabled", () => {
    const candidates = listPersonalMailboxOwnerCandidates(users, accessItems);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.id, "daniel");
    assert.equal(candidates[0]?.name, "Daniel.Hayes");
  });

  it("includes ownerUserId for personal mailbox create requests", () => {
    assert.deepEqual(
      buildCreateMailboxRequest({
        address: "daniel.hayes@echfronthk.com",
        displayName: "Daniel.Hayes",
        mailboxType: "personal",
        ownerUserId: "daniel",
      }),
      {
        address: "daniel.hayes@echfronthk.com",
        displayName: "Daniel.Hayes",
        mailboxType: "personal",
        ownerUserId: "daniel",
      },
    );
  });

  it("blocks personal submit when owner is missing", () => {
    assert.equal(
      validateMailboxCreateForm({
        address: "daniel.hayes@echfronthk.com",
        displayName: "Daniel.Hayes",
        mailboxType: "personal",
        ownerUserId: "",
      }),
      "ownerRequired",
    );
    assert.equal(
      isMailboxCreateSubmitEnabled({
        address: "daniel.hayes@echfronthk.com",
        mailboxType: "personal",
        ownerUserId: "",
      }),
      false,
    );
  });

  it("does not require owner for shared mailbox create requests", () => {
    assert.deepEqual(
      buildCreateMailboxRequest({
        address: "team@echfronthk.com",
        displayName: "Team",
        mailboxType: "shared",
        ownerUserId: "",
      }),
      {
        address: "team@echfronthk.com",
        displayName: "Team",
        mailboxType: "shared",
      },
    );
    assert.equal(
      isMailboxCreateSubmitEnabled({
        address: "team@echfronthk.com",
        mailboxType: "shared",
        ownerUserId: "",
      }),
      true,
    );
  });

  it("clears owner when switching personal to shared", () => {
    assert.equal(resolveMailboxTypeChange("shared", "daniel"), "");
    assert.equal(resolveMailboxTypeChange("personal", "daniel"), "daniel");
  });

  it("omits ownerUserId from shared POST payload even if stale state exists", () => {
    const payload = buildCreateMailboxRequest({
      address: "team@echfronthk.com",
      displayName: "",
      mailboxType: "shared",
      ownerUserId: "daniel",
    });
    assert.equal("ownerUserId" in payload, false);
  });
});
